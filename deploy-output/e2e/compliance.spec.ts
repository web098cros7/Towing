import { expect, test, type Page } from '@playwright/test';

/**
 * Phase-6 surfaces, mocks-on: the alerts feed and the bulk CSV import.
 * Hermetic via `NEXT_PUBLIC_USE_MOCKS` — no backend, no queue.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lakshmi@recovery.in');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

test('alerts page lists open alerts and hides resolved ones by default', async ({ page }) => {
  await login(page);
  await page.goto('/alerts');

  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
  await expect(page.getByText('Insurance expired for KA-01-AB-1234')).toBeVisible();

  // The feed is a to-do list, not an archive.
  await expect(page.getByText('RC expired for KA-19-TN-3344')).toBeHidden();
  await page.getByLabel('Show resolved').check();
  await expect(page.getByText('RC expired for KA-19-TN-3344')).toBeVisible();
  await expect(page.getByText('Resolved').first()).toBeVisible();
});

test('alerts can be filtered by severity', async ({ page }) => {
  await login(page);
  await page.goto('/alerts');

  await page.getByRole('button', { name: 'Warnings' }).click();
  await expect(page.getByText('Permit for KA-51-KL-9012 expires in 25 days')).toBeVisible();
  await expect(page.getByText('Insurance expired for KA-01-AB-1234')).toBeHidden();
});

test('re-check reports what it changed', async ({ page }) => {
  await login(page);
  await page.goto('/alerts');

  await page.getByRole('button', { name: 'Re-check now' }).click();
  await expect(page.getByText(/Re-check complete/)).toBeVisible();
});

test('CSV import previews and validates before uploading', async ({ page }) => {
  await login(page);
  await page.goto('/trucks');

  await page.getByRole('button', { name: 'Import CSV' }).click();
  const drawer = page.getByTestId('bulk-import-drawer');
  await expect(drawer).toBeVisible();

  // Two good rows, one bad plate, one bad vehicle class.
  await drawer.getByLabel('CSV file').setInputFiles({
    name: 'trucks.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'plate,type,capacityTons\nKA-77-NEW-0001,flatbed,5\nBAD,flatbed,5\nKA-78-NEW-0002,tricycle,4\nKA-79-NEW-0003,wheel_lift,3',
    ),
  });

  // Pre-validation happens client-side, before any upload.
  await expect(drawer.getByText('2 ready')).toBeVisible();
  await expect(drawer.getByText('2 with errors')).toBeVisible();
  await expect(drawer.getByText(/Row 2 · plate/)).toBeVisible();
  await expect(drawer.getByText(/Row 3 · type/)).toBeVisible();

  await drawer.getByRole('button', { name: /Import 2 truck/ }).click();
  await expect(page.getByTestId('import-result')).toContainText('Imported 2 of 4 rows');
  await expect(drawer.getByRole('button', { name: 'Download error report' })).toBeVisible();
});

test('CSV import rejects a file with the wrong header', async ({ page }) => {
  await login(page);
  await page.goto('/trucks');
  await page.getByRole('button', { name: 'Import CSV' }).click();

  const drawer = page.getByTestId('bulk-import-drawer');
  await drawer.getByLabel('CSV file').setInputFiles({
    name: 'wrong.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('plate,type\nKA-01-AB-1234,flatbed'),
  });

  await expect(drawer.getByText(/Missing column\(s\): capacityTons/)).toBeVisible();
  // Nothing importable, so the action stays disabled.
  await expect(drawer.getByRole('button', { name: /^Import/ })).toBeDisabled();
});
