import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W6 — the fleets directory and the fleet-suspend confirmation, mocks-on
 * (§9.4.5).
 *
 * The typed-name gate is the point of this file: one click here takes a whole
 * fleet offline, so the confirm button stays disabled until the operator has
 * typed the business name exactly AND given a reason. The server-side chain
 * (status trio, offer revocation, per-driver notification) is proved against
 * the real backend in `admin-fleets-directory.e2e.spec.ts`.
 */
test.describe('admin fleets directory', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('searches and filters fleets', async ({ page }) => {
    await page.goto('/admin/fleets');
    await expect(page.getByRole('heading', { name: 'Fleets' })).toBeVisible();

    await expect(page.getByText('Bengaluru Heavy Towing')).toBeVisible();
    await expect(page.getByText('Mysuru Quick Tow')).toBeVisible();
    // The dry-run counts render inline.
    await expect(page.getByText('24')).toBeVisible();
    await expect(page.getByText('(11 online)')).toBeVisible();

    await page.getByTestId('admin-fleet-search').fill('mysuru');
    await expect(page.getByText('Bengaluru Heavy Towing')).toHaveCount(0);
    await expect(page.getByText('Mysuru Quick Tow')).toBeVisible();
    await page.getByTestId('admin-fleet-search').fill('');

    await page.getByTestId('admin-fleet-status-filter').selectOption('suspended');
    await expect(page.getByText('Bengaluru Heavy Towing')).toHaveCount(0);
    await expect(page.getByText('Mysuru Quick Tow')).toBeVisible();
  });

  test('opens a fleet: trucks, drivers, earnings, and the typed-name suspend', async ({ page }) => {
    await page.goto('/admin/fleets/00000000-0000-4000-8000-000000000021');
    await expect(page.getByTestId('admin-fleet-detail')).toContainText('Bengaluru Heavy Towing');
    await expect(page.getByTestId('admin-fleet-dry-run')).toContainText('24');

    await page.getByRole('tab', { name: 'Trucks' }).click();
    await expect(page.getByText('KA01XY9999')).toBeVisible();

    await page.getByRole('tab', { name: 'Drivers' }).click();
    await expect(page.getByText('Kiran Shetty')).toBeVisible();

    await page.getByRole('tab', { name: 'Earnings' }).click();
    await expect(page.getByTestId('admin-fleet-earnings')).toContainText('5,400');

    // The typed-name gate: reason + exact business name are both required.
    await page.getByTestId('admin-fleet-suspend').click();
    const submit = page.getByTestId('suspend-dialog-submit');
    await page.getByTestId('suspend-dialog-reason').fill('Operating without valid insurance');
    await expect(submit).toBeDisabled();
    await page.getByTestId('suspend-dialog-typed-name').fill('Bengaluru Heavy');
    await expect(submit).toBeDisabled();
    await page.getByTestId('suspend-dialog-typed-name').fill('Bengaluru Heavy Towing');
    await expect(submit).toBeEnabled();
    await submit.click();
    // The native <dialog> keeps its children in the DOM — assert HIDDEN.
    await expect(submit).toBeHidden();
  });
});
