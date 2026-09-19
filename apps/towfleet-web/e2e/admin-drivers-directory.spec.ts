import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W6 — the drivers directory and its zones editor, mocks-on (§9.4.4).
 *
 * The zone editor is a full replacement of `driver_zone_restrictions`; this
 * file proves the CONSOLE contract: unchecked means unrestricted, the save
 * button only lights up when the set actually changed, and a save reports
 * back. The eligibility consequence of a restriction is proved against the
 * real engine in `eligibility.e2e.spec.ts` (`zone_restricted`).
 */
test.describe('admin drivers directory', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('filters drivers and opens one', async ({ page }) => {
    await page.goto('/admin/drivers/list');
    await expect(page.getByRole('heading', { name: 'Drivers' })).toBeVisible();

    await expect(page.getByText('Kiran Shetty')).toBeVisible();
    await expect(page.getByText('Deepak Verma')).toBeVisible();

    // Online-only drops the suspended, offline driver.
    await page.getByTestId('admin-driver-online-filter').selectOption('true');
    await expect(page.getByText('Deepak Verma')).toHaveCount(0);
    await expect(page.getByText('Kiran Shetty')).toBeVisible();
    await page.getByTestId('admin-driver-online-filter').selectOption('');

    // KYC filter narrows to the suspended driver.
    await page.getByTestId('admin-driver-kyc-filter').selectOption('suspended');
    await expect(page.getByText('Kiran Shetty')).toHaveCount(0);
    await expect(page.getByText('Deepak Verma')).toBeVisible();
    await page.getByTestId('admin-driver-kyc-filter').selectOption('');

    await page.getByTestId('admin-driver-open').first().click();
    await expect(page).toHaveURL(/\/admin\/drivers\/list\/[0-9a-f-]+$/);
    await expect(page.getByTestId('admin-driver-detail')).toBeVisible();
  });

  test('edits zone restrictions and suspensions the driver', async ({ page }) => {
    await page.goto('/admin/drivers/list/00000000-0000-4000-8000-000000000012');
    await expect(page.getByTestId('admin-driver-detail')).toContainText('Suresh Nair');

    // The restricted driver starts with one blocked zone; saving is disabled
    // until the set changes.
    await page.getByRole('tab', { name: 'Zones' }).click();
    await expect(page.getByTestId('admin-driver-zones')).toBeVisible();
    const save = page.getByTestId('admin-zones-save');
    await expect(save).toBeDisabled();
    await expect(
      page.getByTestId('admin-zone-checkbox-00000000-0000-4000-8000-000000000043'),
    ).toBeChecked();

    // Check a second zone → save → the "Saved" note appears.
    await page.getByTestId('admin-zone-checkbox-00000000-0000-4000-8000-000000000042').check();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId('admin-zones-saved')).toBeVisible();
    await expect(save).toBeDisabled();

    // Suspend through the shared dialog: reason-gated, then closes.
    await page.getByTestId('admin-driver-detail-suspend').click();
    await page.getByTestId('suspend-dialog-reason').fill('Repeated policy violations');
    await page.getByTestId('suspend-dialog-submit').click();
    // The native <dialog> keeps its children in the DOM — assert HIDDEN.
    await expect(page.getByTestId('suspend-dialog-submit')).toBeHidden();
  });
});
