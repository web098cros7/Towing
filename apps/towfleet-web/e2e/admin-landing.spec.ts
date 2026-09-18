import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * A6/A7 — the `/admin` landing (mocks-on).
 *
 * Neutral (M0-F7): no sub-role is redirected to a queue. Cards for queues the
 * role would get a 403 on stay hidden — operations sees both, finance sees
 * only payouts (intercepted identity below; the mock session cannot mint
 * one). The unauthenticated redirect to `/admin/login` is unchanged.
 */

test('an operations admin stays on the neutral landing and sees both queues', async ({
  page,
}) => {
  await adminLogin(page);

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  await expect(page.getByText('Verification queue')).toBeVisible();
  await expect(page.getByText('Payout approvals')).toBeVisible();
});

test('a finance admin sees only the payouts card', async ({ page }) => {
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

  // The mock verify response lands first; the landing filters once identity
  // resolves — no redirect, just the finance card.
  await page.waitForURL((url) => !url.pathname.startsWith('/admin/login'));
  await expect(page.getByText('Payout approvals')).toBeVisible();
  await expect(page.getByText('Verification queue')).toHaveCount(0);
});

test('an unauthenticated visitor hitting /admin is redirected to /admin/login', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});
