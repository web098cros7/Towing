import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * A6/A7/W3 — the `/admin` landing (mocks-on).
 *
 * W3 replaced the neutral landing with the ops dashboard for `ops.live`
 * holders (`super_admin`, `operations`, `support`). Finance is the one sub-role
 * without the permission, and it keeps the neutral quick links rather than a
 * 403 panel or a redirect (M0-F7 removed role routing). The unauthenticated
 * redirect to `/admin/login` is unchanged.
 */

test('an operations admin lands on the ops dashboard, not the scaffolding', async ({ page }) => {
  await adminLogin(page);

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  // The dashboard is what renders now — KPI grid plus the live feed.
  await expect(page.getByText('Active rides')).toBeVisible();
  await expect(page.getByText('Live activity')).toBeVisible();
  // And the sidebar badge is filled from the ops badges source, not left blank.
  await expect(page.getByTestId('admin-nav-badge-verification')).toHaveText('4');
});

test('a finance admin keeps the neutral quick links instead of a 403', async ({ page }) => {
  await page.route('/api/admin-session', async (route) => {
    await route.fulfill({
      json: {
        admin: {
          // Must satisfy `adminIdentitySchema` — the landing parses it.
          id: '00000000-0000-4000-8000-000000000002',
          email: 'finance@towing.local',
          name: 'Mock Finance',
          subRole: 'finance',
          twofaEnabled: false,
          twofaEnrolmentRequired: false,
        },
      },
    });
  });

  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('finance@towing.local');
  await page.getByLabel('Password', { exact: true }).fill('AdminPass123!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Finance holds no `ops.live`: no dashboard, no redirect — just its cards.
  await page.waitForURL((url) => !url.pathname.startsWith('/admin/login'));
  await expect(page.getByText('Payout approvals')).toBeVisible();
  await expect(page.getByText('Verification queue')).toHaveCount(0);
  await expect(page.getByText('Active rides')).toHaveCount(0);
});

test('an unauthenticated visitor hitting /admin is redirected to /admin/login', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});
