import { expect, test, type Page } from '@playwright/test';
import { adminLiveLogin } from './support/adminLiveLogin';

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
  await adminLiveLogin(page, 'ops@towing.local');
}

// Read-only first, on purpose: the second test approves Prakash Naik out of
// the queue, and `pnpm db:reset` only seeds one pending driver. Running the
// mutating test first would leave this one with an empty queue to assert on.
test('a support admin can see the queue but has no way to decide from it', async ({ page }) => {
  // M0-F3: the helper returns only once the session cookies are set, so the
  // walk-on `goto` below can no longer race the login.
  await adminLiveLogin(page, 'support@towing.local');

  await page.goto('/admin/drivers');
  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();
  await expect(page.getByText('Prakash Naik')).toBeVisible();
});

test('admin can approve a real KYC submission end to end', async ({ page }) => {
  await loginAsOps(page);

  await page.goto('/admin/drivers');
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
