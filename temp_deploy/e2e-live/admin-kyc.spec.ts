import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 11's own acceptance bar, mocks-off: admin login → queue → drawer →
 * render a document through a REAL signed GET → approve → row leaves the
 * queue. `pnpm db:reset` before running seeds exactly one `pending` driver
 * (Prakash Naik) with 5 real placeholder documents on disk — this spec is not
 * idempotent across re-runs without a reseed, the same way `smoke.spec.ts`'s
 * mocks-off cousins aren't.
 */

const BACKEND_URL = process.env.LIVE_BACKEND_URL ?? 'http://localhost:4000';

async function loginAsOps(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('ops@towing.local');
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Continue' }).click();

  // The dev-OTP-echo route is the same mechanism the mocks-off fleet run
  // would use — it exists specifically so a browser test never has to scrape
  // a log. Called directly against the backend since the web app has no proxy
  // for it (nothing shipped should ever route this in production).
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
  await expect(page).toHaveURL(/\/admin\/drivers/);
}

// Read-only first, on purpose: the second test approves Prakash Naik out of
// the queue, and `pnpm db:reset` only seeds one pending driver. Running the
// mutating test first would leave this one with an empty queue to assert on.
test('a support admin can see the queue but has no way to decide from it', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('support@towing.local');
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

  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();
  await expect(page.getByText('Prakash Naik')).toBeVisible();
});

test('admin can approve a real KYC submission end to end', async ({ page }) => {
  await loginAsOps(page);

  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();
  const row = page.getByText('Prakash Naik');
  await expect(row).toBeVisible();

  await row.click();
  await expect(page.getByRole('heading', { name: 'Prakash Naik' })).toBeVisible();

  // A real document, rendered through a real signed GET — not a mock data:
  // URI. If the signature or the traversal guard ever regresses, this image
  // fails to load instead of a test asserting a hardcoded fixture string.
  const thumbnail = page.locator('img[alt="Driving licence document"]');
  await expect(thumbnail).toBeVisible();
  const src = await thumbnail.getAttribute('src');
  expect(src).toMatch(new RegExp(`^${BACKEND_URL}/v1/files/driver-documents/.+sig=`));

  const naturalWidth = await thumbnail.evaluate((el: HTMLImageElement) => el.naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);

  await page.getByTestId('kyc-decide-approve').click();

  // The drawer closes and the row is gone — the queue is strictly
  // `kyc_status = 'pending'`, and this driver no longer is.
  await expect(page.getByRole('heading', { name: 'Prakash Naik' })).toBeHidden();
  await expect(row).toBeHidden();
  await expect(page.getByText('Queue is empty')).toBeVisible();
});
