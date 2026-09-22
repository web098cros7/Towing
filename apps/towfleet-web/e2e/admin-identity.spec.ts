import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * A7 — identity reaches the UI (mocks-on).
 *
 * The mock session is `operations` (`Mock Admin`). The mock queue APIs answer
 * for every sub-role, so a 403 cannot be forced hermetically — the forbidden
 * panel is proven against real RBAC in `e2e-live/admin-403.spec.ts` instead.
 */

test('any admin screen knows who is signed in', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');

  // The top bar carries the name; the sub-role lives in the account menu.
  await expect(page.getByTestId('admin-identity')).toHaveText('Mock Admin');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menu')).toContainText('operations');
});
