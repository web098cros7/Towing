import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W1's session list + W2's two-factor settings, hermetic (mocks-on).
 *
 * RENDERS ONLY: the revoke button calls a deliberate no-op in mocks, and the
 * real revoke (refresh family burned, next use 401s) is asserted in the
 * backend's `admin-sessions.e2e.spec.ts` against a real database.
 */
test('the security page lists the caller’s active sessions', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/settings/security');

  await expect(page.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
  await expect(page.getByTestId('session-item')).toHaveCount(2);

  // IPC and the relative timestamps render for each row, and every row offers
  // the revoke affordance.
  await expect(page.getByText('49.207.14.9')).toBeVisible();
  await expect(page.getByText('49.207.14.31')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(2);
});

test('the two-factor card still owns the page', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/settings/security');

  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
  // Mock identity has no TOTP enrolled, so the setup affordance is the one on
  // screen — the enrol flow itself is proven in `e2e-live/admin-totp.spec.ts`.
  await expect(page.getByRole('button', { name: 'Set up authenticator' })).toBeVisible();
});

test('a super admin with no authenticator is sent to set one up, from anywhere', async ({
  page,
}) => {
  // ADM-16. The server refuses such an admin every other route, so the console
  // must not leave them on a page that can only render errors. Signed in
  // FIRST, then given the enrolment-owing identity: the redirect fires the
  // moment identity loads, which would otherwise pre-empt the login helper's
  // own landing check.
  await adminLogin(page);
  await page.route('/api/admin-session', async (route) => {
    await route.fulfill({
      json: {
        admin: {
          id: '00000000-0000-4000-8000-000000000003',
          email: 'owner@towing.local',
          name: 'Mock Owner',
          subRole: 'super_admin',
          twofaEnabled: false,
          twofaEnrolmentRequired: true,
        },
      },
    });
  });
  await page.goto('/admin/finance');

  await expect(page).toHaveURL(/\/admin\/settings\/security$/);
  await expect(page.getByTestId('totp-required-notice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up authenticator' })).toBeVisible();
});
