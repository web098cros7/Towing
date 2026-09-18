import { expect, test, type Page } from '@playwright/test';
import { adminLiveLogin } from './support/adminLiveLogin';

/**
 * A7's 403 panel, mocks-off: real RBAC refusals render an explanation.
 *
 * `support` may read the KYC queue but not the finance queue; `finance` may
 * read payouts but not the KYC queue (`@Roles` on the controllers). Both
 * refusals must read as access-denied, never "something went wrong". Needs
 * `pnpm db:reset` state only insofar as the seeded admins exist.
 */

async function loginAs(page: Page, email: string) {
  await adminLiveLogin(page, email);
}

test('a support admin sees an explanation on the finance queue', async ({ page }) => {
  await loginAs(page, 'support@towing.local');
  await page.goto('/admin/finance');

  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  await expect(page.getByText(/don't have access to payout approvals/)).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
});

test('a finance admin sees an explanation on the KYC queue', async ({ page }) => {
  await loginAs(page, 'finance@towing.local');
  await page.goto('/admin/drivers');

  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  await expect(page.getByText(/don't have access to the verification queue/)).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
});
