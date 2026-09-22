import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W1's audit viewer, hermetic (mocks-on).
 *
 * RENDERS AND FILTERS ONLY — the same rule as the finance queue: the feed is a
 * read, and the write side (what lands a row here) is asserted against a real
 * database in the backend's `admin-audit.e2e.spec.ts`.
 */
test('the audit feed renders newest-first with recorded actions', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/audit');

  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible();
  await expect(page.getByText('driver.kyc.approve')).toBeVisible();
  await expect(page.getByText('payout.approve')).toBeVisible();

  // Newest-first: the KYC approval (35 min ago) sits above the payout (3 h
  // ago). Comparing vertical positions is what makes this an ORDER assertion
  // rather than a mere presence one.
  const kycBox = await page.getByText('driver.kyc.approve').boundingBox();
  const payoutBox = await page.getByText('payout.approve').boundingBox();
  expect(kycBox!.y).toBeLessThan(payoutBox!.y);
});

test('the action prefix filter narrows the feed', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/audit');

  await expect(page.getByText('driver.kyc.approve')).toBeVisible();

  await page.getByLabel('Filter by action prefix').fill('payout');

  await expect(page.getByText('payout.approve')).toBeVisible();
  await expect(page.getByText('driver.kyc.approve')).toHaveCount(0);
});

test('a row opens the drawer with a before/after diff', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/audit');

  await page.getByText('driver.kyc.approve').click();

  await expect(page.getByTestId('audit-detail-action')).toHaveText('driver.kyc.approve');
  // The changed field is highlighted in the object diff (W1's JsonDiff).
  await expect(page.getByTestId('diff-changed-kycStatus')).toBeVisible();
});
