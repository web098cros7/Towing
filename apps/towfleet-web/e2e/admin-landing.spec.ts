import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * A6/A7 — the `/admin` landing (mocks-on).
 *
 * A6 made it neutral; A7 routes it by sub-role once identity resolves (mock
 * login is `operations`, so it lands on the KYC queue). The finance leg is
 * covered with an intercepted identity below — the mock session cannot mint
 * one.
 */

test('an operations admin landing on /admin is routed to the KYC queue', async ({ page }) => {
  await adminLogin(page);

  await expect(page).toHaveURL(/\/admin\/drivers/);
  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();
});

test('a finance admin landing on /admin is routed to finance, not the KYC queue', async ({
  page,
}) => {
  await page.route('/api/admin-session', async (route) => {
    await route.fulfill({
      json: {
        admin: {
          // Must satisfy `adminIdentitySchema` — the landing parses it.
          id: '00000000-0000-4000-8000-000000000002',
          email: 'finance@towing.local',
          name: 'Mock Finance',
          subRole: 'finance',
        },
      },
    });
  });

  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('finance@towing.local');
  await page.getByLabel('Password').fill('AdminPass123!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/admin\/finance/);
  await expect(page.getByRole('heading', { name: 'Payout approvals' })).toBeVisible();
  await expect(page.getByText('Ramesh Kumar')).toBeVisible();
});

test('an unauthenticated visitor hitting /admin is redirected to /admin/login', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});
