import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * A19 — the KYC drawer holds a live row and shows errors (mocks-on).
 *
 * Deliberate bend of the house rule (`admin-kyc.spec.ts` header: mocks-on
 * specs assert renders, never mutations). These tests prove DRAWER WIRING —
 * the row derives from query data, the toggle merges into it, failures
 * render inline — against stubbed service responses, never backend behaviour:
 * `updateCapabilities` merges into the real query cache (no mock change), and
 * decision failures come from mockSource's documented `mock-failure`
 * sentinel (route interception cannot reach a source that never fetches).
 * Backend behaviour stays e2e-live territory.
 */

test('toggling a capability updates the drawer without a reload', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');
  await page.getByText('Prakash Naik').click();
  await expect(page.getByRole('heading', { name: 'Prakash Naik' })).toBeVisible();

  // Prakash ships opted out in the mock.
  const toggle = page.getByRole('dialog').getByRole('switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await toggle.click();

  // Merged into the queue cache on success (and confirmed by refetch): the
  // drawer derives from query data, so it flips with no reload.
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

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
