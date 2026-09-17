import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * A3's acceptance bar, mocks-off: the payout Reject button round-trips
 * through the fixed `adminApiFetch` against a real backend and a real ledger.
 *
 * Before the fix, `reject`/`updateConfig` sent a JSON string with no
 * `Content-Type`, Nest's JSON parser skipped the body, and `@ZodBody`
 * answered 422 — so rejecting a payout failed. This spec fails on that build
 * (the confirm click errors instead of closing the drawer) and passes on the
 * fixed one.
 *
 * Setup runs through the backend API (`page.request`): finance-admin login,
 * a low auto-approve threshold via `PUT finance/config` (which is also the
 * "saving finance config succeeds against a real backend" half of A3 — the
 * config page itself is W9 and does not exist yet), then a fleet payout above
 * the threshold so it queues as `pending_approval`. The decision itself goes
 * through the UI, i.e. through `adminApiFetch`.
 *
 * Not idempotent without a reseed for the *created* payout only: a re-run
 * reuses the still-pending payout from the previous run instead of creating a
 * second one (`uq_payouts_one_open_per_owner` would 409 it). `pnpm db:reset`
 * before running restores the deterministic state.
 */

const BACKEND_URL = process.env.LIVE_BACKEND_URL ?? 'http://localhost:4000';

// ₹1,000 — low enough that the test payout queues, high enough to stay a
// realistic threshold for the rest of the suite while this runs.
const TEST_THRESHOLD_PAISE = 100_000;
// ₹10,000 — above the test threshold, small against a seeded fleet balance.
const TEST_PAYOUT_PAISE = 1_000_000;
const REJECT_REASON = 'Bank details do not match the KYC name';

async function backendLogin(
  request: APIRequestContext,
  loginPath: 'admin/auth' | 'fleet/auth',
  credentials: { email: string; password: string },
): Promise<string> {
  const loginRes = await request.post(`${BACKEND_URL}/v1/${loginPath}/login`, {
    data: credentials,
  });
  expect(loginRes.ok(), `${loginPath}/login must accept the seeded credentials`).toBe(true);
  const { challengeId } = (await loginRes.json()) as { challengeId: string };

  const otpRes = await request.get(`${BACKEND_URL}/v1/${loginPath}/dev/otp?challengeId=${challengeId}`);
  expect(otpRes.ok(), 'dev OTP echo must be enabled (AUTH_DEV_OTP_ECHO=true)').toBe(true);
  const { otp } = (await otpRes.json()) as { otp: string };

  const verifyRes = await request.post(`${BACKEND_URL}/v1/${loginPath}/verify`, {
    data: { challengeId, otp },
  });
  expect(verifyRes.ok(), `${loginPath}/verify must accept the echoed OTP`).toBe(true);
  const { accessToken } = (await verifyRes.json()) as { accessToken: string };
  return accessToken;
}

async function loginAsFinance(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('finance@towing.local');
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Continue' }).click();

  const challengeIdMatch = await page.waitForResponse((res) =>
    res.url().includes('/api/admin-session/login'),
  );
  const { challengeId } = (await challengeIdMatch.json()) as { challengeId: string };

  const otpRes = await page.request.get(
    `${BACKEND_URL}/v1/admin/auth/dev/otp?challengeId=${challengeId}`,
  );
  const { otp } = (await otpRes.json()) as { otp: string };

  await page.getByLabel('One-time code').fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/);
}

interface QueueItem {
  id: string;
  ownerType: string;
  ownerName: string | null;
  amountPaise: number;
  approvalState: string;
  rejectionReason: string | null;
}

test('rejecting a payout works end to end against a real backend', async ({ page, request }) => {
  // 1. Finance config saves: lower the threshold so the test payout queues.
  const financeToken = await backendLogin(request, 'admin/auth', {
    email: 'finance@towing.local',
    password: 'Password123!',
  });
  const configRes = await request.put(`${BACKEND_URL}/v1/admin/finance/config`, {
    headers: { Authorization: `Bearer ${financeToken}` },
    data: { payoutAutoApproveMaxPaise: TEST_THRESHOLD_PAISE },
  });
  expect(configRes.ok(), 'PUT finance/config must succeed').toBe(true);
  expect((await configRes.json()) as { payoutAutoApproveMaxPaise: number }).toMatchObject({
    payoutAutoApproveMaxPaise: TEST_THRESHOLD_PAISE,
  });

  // 2. A pending payout: reuse one still queued from a previous run, else
  // request one as the seeded Lakshmi fleet (it holds a balance and a linked
  // destination in the seed).
  const queueRes = await request.get(
    `${BACKEND_URL}/v1/admin/finance/payouts?state=pending_approval&page=1&limit=50`,
    { headers: { Authorization: `Bearer ${financeToken}` } },
  );
  expect(queueRes.ok()).toBe(true);
  const queued = ((await queueRes.json()) as { items: QueueItem[] }).items;

  let target = queued[0];
  if (!target) {
    const fleetToken = await backendLogin(request, 'fleet/auth', {
      email: 'lakshmi@recovery.in',
      password: 'Password123!',
    });
    const payoutRes = await request.post(`${BACKEND_URL}/v1/fleet/payouts`, {
      headers: { Authorization: `Bearer ${fleetToken}`, 'Idempotency-Key': randomUUID() },
      data: { amountPaise: TEST_PAYOUT_PAISE },
    });
    expect(payoutRes.status(), 'fleet payout above the threshold must queue').toBe(201);
    const created = (await payoutRes.json()) as { id: string; approvalState: string };
    expect(created.approvalState).toBe('pending_approval');

    const reread = (await (
      await request.get(
        `${BACKEND_URL}/v1/admin/finance/payouts?state=pending_approval&page=1&limit=50`,
        { headers: { Authorization: `Bearer ${financeToken}` } },
      )
    ).json()) as { items: QueueItem[] };
    target = reread.items.find((item) => item.id === created.id)!;
    expect(target, 'the queued payout must appear in the admin queue').toBeTruthy();
  }
  const payoutId = target!.id;
  const ownerName = target!.ownerName ?? 'Unnamed';

  // 3. The decision goes through the UI — i.e. through `adminApiFetch` with a
  // JSON string body and no per-call Content-Type (the A3 bug shape).
  await loginAsFinance(page);
  await page.goto('/admin/finance');
  await expect(page.getByRole('heading', { name: 'Payout approvals' })).toBeVisible();

  await page.getByText(ownerName).first().click();
  await page.getByTestId('finance-decide-reject').click();
  await page.getByTestId('finance-reject-reason').fill(REJECT_REASON);
  await page.getByTestId('finance-confirm-reject').click();

  // Success closes the drawer; the row leaves the pending queue.
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(ownerName)).toHaveCount(0);

  // 4. The row's state changed server-side, with the reason recorded.
  const afterRes = await request.get(
    `${BACKEND_URL}/v1/admin/finance/payouts?state=all&page=1&limit=100`,
    { headers: { Authorization: `Bearer ${financeToken}` } },
  );
  expect(afterRes.ok()).toBe(true);
  const after = ((await afterRes.json()) as { items: QueueItem[] }).items.find(
    (item) => item.id === payoutId,
  );
  expect(after, 'the rejected payout must still be listed under state=all').toBeTruthy();
  expect(after).toMatchObject({ approvalState: 'rejected', rejectionReason: REJECT_REASON });
});
