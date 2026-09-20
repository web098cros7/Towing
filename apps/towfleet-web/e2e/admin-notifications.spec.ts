import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W18's notification console, hermetic (mocks-on).
 *
 * The mock identity is `operations`, which holds `notification.view` but NOT
 * `admin.manage` — so the e2e can prove the exact guard the guide asked for:
 * ops READS the catalogue and the log, and the test-send control is refused
 * with its reason on screen. (The send itself is proven in the backend spec
 * as a super admin, and in the live look.)
 */

test('the template catalogue names the channels that cannot send', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/settings/notifications');

  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

  const rows = page.getByTestId('template-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByText('driver_kyc_approved')).toBeVisible();

  // The operationally important fact, loud: SMS and WhatsApp ids are pending.
  await expect(page.getByTestId('unusable-sms').first()).toBeVisible();
  await expect(page.getByTestId('unusable-whatsapp').first()).toBeVisible();

  // A usable template says so instead.
  await expect(page.getByText('all channels').first()).toBeVisible();
});

test('the delivery log filters and shows the dead-letter depth', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/settings/notifications');
  await page.getByTestId('tab-deliveries').click();

  await expect(page.getByText('Dead-letter depth')).toBeVisible();
  await expect(page.getByText(/dlt_template_missing/)).toBeVisible();
  await expect(page.getByText('payout.paid')).toBeVisible();

  await page.getByTestId('deliveries-status').selectOption('failed');
  await expect(page.getByText(/dlt_template_missing/)).toBeVisible();
  await expect(page.getByText('payout.paid')).toHaveCount(0);

  await page.getByTestId('deliveries-channel').selectOption('email');
  await expect(page.getByText('No deliveries match')).toBeVisible();
});

test('the test-send is withheld from non-super admins with the reason', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/settings/notifications');
  await page.getByTestId('tab-test').click();

  await expect(page.getByTestId('test-send')).toBeDisabled();
  await expect(page.getByTestId('test-send-guard')).toContainText('Super admin only');
});
