import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * A19 — the KYC drawer holds a live row and shows errors (mocks-on).
 *
 * Deliberate bend of the house rule (`admin-kyc.spec.ts` header: mocks-on
 * specs assert renders, never mutations). This test proves DRAWER WIRING —
 * failures render inline — against the mockSource's documented
 * `mock-failure` sentinel (route interception cannot reach a source that
 * never fetches). The capability TOGGLE used to be asserted here too, but the
 * mock refetch flips the switch back after `mockDelay`, so that assertion
 * passed only inside a ~450 ms polling window (M0-F15) — it is proven in
 * `e2e-live/admin-kyc.spec.ts` instead. Backend behaviour stays e2e-live
 * territory.
 */

test('a failed decision shows why, and the error clears on close', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');
  await page.getByText('Prakash Naik').click();
  await expect(page.getByRole('heading', { name: 'Prakash Naik' })).toBeVisible();

  await page.getByTestId('kyc-decide-reject').click();
  await page.locator('#overall-reason').fill('mock-failure');
  await page.getByRole('button', { name: 'Confirm reject' }).click();

  await expect(page.getByTestId('kyc-error')).toBeVisible();
  await expect(page.getByTestId('kyc-error')).toContainText(/Mock failure/);

  // Back out and reopen: no stale error, no stale reason.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByText('Prakash Naik').click();
  await expect(page.getByRole('heading', { name: 'Prakash Naik' })).toBeVisible();
  await expect(page.getByTestId('kyc-error')).toHaveCount(0);
});
