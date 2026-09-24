import { expect, test, type Page } from '@playwright/test';

/**
 * Trucks page, mocks-on: make and model (what the customer's vehicle card shows)
 * in the table, the truck drawer and the Add truck drawer. Renders only; the
 * writes are proven in `trucks.e2e.spec.ts` and `imports.e2e.spec.ts`.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lakshmi@recovery.in');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

test('the table shows each truck’s make and model, or that it is not set', async ({ page }) => {
  await login(page);
  await page.goto('/trucks');

  await expect(page.getByRole('columnheader', { name: 'Make & model' })).toBeVisible();
  await expect(page.getByRole('row', { name: /KA-01-AB-1234/ })).toContainText('Tata 407');
  await expect(page.getByText('Not set').first()).toBeVisible();

  // The search finds a truck by its make too.
  await page.getByTestId('trucks-search').fill('leyland');
  await expect(page.getByRole('row', { name: /KA-05-MJ-7788/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /KA-01-AB-1234/ })).toBeHidden();
});

test('the truck drawer shows its make and model as editable details', async ({ page }) => {
  await login(page);
  await page.goto('/trucks?truck=tr-1');

  const details = page.getByTestId('truck-details');
  await expect(details.getByLabel('Make')).toHaveValue('Tata');
  await expect(details.getByLabel('Model')).toHaveValue('407');
  // Nothing changed yet, so there is nothing to save.
  await expect(details.getByRole('button', { name: 'Save details' })).toBeDisabled();
  await details.getByLabel('Model').fill('407 Gold');
  await expect(details.getByRole('button', { name: 'Save details' })).toBeEnabled();
});

test('Add truck opens a form that asks for make and model', async ({ page }) => {
  await login(page);
  await page.goto('/trucks');

  await page.getByRole('button', { name: 'Add truck' }).click();
  const drawer = page.getByTestId('add-truck-drawer');
  await expect(drawer.getByLabel('Plate')).toBeVisible();
  await expect(drawer.getByLabel('Make')).toBeVisible();
  await expect(drawer.getByLabel('Model')).toBeVisible();

  // Plate and capacity are required: the submit waits for both.
  const submit = drawer.getByRole('button', { name: 'Add truck' });
  await expect(submit).toBeDisabled();
  await drawer.getByLabel('Plate').fill('KA-99-ZZ-4070');
  await drawer.getByLabel('Capacity (tonnes)').fill('5');
  await expect(submit).toBeEnabled();
});
