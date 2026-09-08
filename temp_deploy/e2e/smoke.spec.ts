import { expect, test } from '@playwright/test';

/** Phase-2 smoke: login (mock mode) then every console route renders. */

test('unauthenticated visitor is redirected to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'TowFleet' })).toBeVisible();
});

test('login and walk every console route', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lakshmi@recovery.in');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  const routes: Array<[path: string, heading: string]> = [
    ['/map', 'Live Map'],
    ['/trucks', 'Trucks'],
    ['/drivers', 'Drivers'],
    ['/jobs', 'Jobs'],
    ['/earnings', 'Earnings & Payouts'],
    ['/reports', 'Reports'],
    ['/settings', 'Settings'],
  ];

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // Trucks drawer: click the non-compliant truck and see the checklist.
  await page.goto('/trucks');
  await page.getByText('KA-01-AB-1234').click();
  await expect(page.getByRole('heading', { name: 'Compliance checklist' })).toBeVisible();
  await expect(page.getByText('excluded from dispatch')).toBeVisible();
});
