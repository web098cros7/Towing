import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W1's shell requirement (§3.2, exit gate): "a support admin logging in sees
 * only permitted nav". Hermetic — rendering only, like every mocks-on spec.
 *
 * The mock identity is `operations` (`app/api/admin-session/route.ts`), and the
 * nav filters through the SAME `ROLE_PERMISSIONS` table the backend guard
 * enforces, so this asserts the two consumers agree on the one map.
 */
test('the sidebar shows an operator exactly the sections their permissions allow', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin');

  // Held by `operations`.
  await expect(page.getByTestId('admin-nav-dashboard')).toBeVisible();
  await expect(page.getByTestId('admin-nav-verification')).toBeVisible();
  await expect(page.getByTestId('admin-nav-audit')).toBeVisible();
  await expect(page.getByTestId('admin-nav-sos')).toBeVisible();
  // Self-service — every admin, permissionless.
  await expect(page.getByTestId('admin-nav-settings')).toBeVisible();

  // NOT held by `operations`: the admin directory (super_admin only) and the
  // privacy queue are the two a hidden item matters most for.
  await expect(page.getByTestId('admin-nav-admins')).toHaveCount(0);
  await expect(page.getByTestId('admin-nav-privacy')).toHaveCount(0);
  // Finance and Commission need `finance.read` / `commission.edit`; operations
  // has only `finance.summary` / `commission.propose`.
  await expect(page.getByTestId('admin-nav-finance')).toHaveCount(0);
  await expect(page.getByTestId('admin-nav-commission')).toHaveCount(0);
});

test('the sidebar marks the current section, and the topbar carries identity', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');

  await expect(page.getByTestId('admin-nav-verification')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('admin-nav-dashboard')).not.toHaveAttribute('aria-current', 'page');

  await expect(page.getByTestId('admin-identity')).toContainText('operations');
});
