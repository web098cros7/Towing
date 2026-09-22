import { expect, test } from '@playwright/test';
import { adminLiveLogin } from './support/adminLiveLogin';

/**
 * M0-F1: the identity route survives access-token expiry.
 *
 * Before the fix, `GET /api/admin-session` called `/me` with the raw cookie
 * and cleared both cookies on a 401, so any reload past the access TTL
 * bounced the admin to `/admin/login`. Now the route shares the proxy's
 * refresh-once-and-retry, and cookies are cleared only when the refresh
 * itself fails.
 *
 * Needs a backend started with `JWT_ACCESS_TTL_SECONDS=15`: log in, wait past
 * expiry, reload, and assert the admin is still on the page with both cookies
 * present. (Runs in its own short live run — a 15 s TTL would flake the other
 * live specs.)
 */

test('reloading past access expiry keeps the admin signed in', async ({ page, context }) => {
  await adminLiveLogin(page, 'ops@towing.local');
  await page.goto('/admin/drivers');
  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();

  // Past the 15 s access TTL (with margin), but inside the refresh lifetime.
  await page.waitForTimeout(20_000);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();
  await expect(page).toHaveURL((url) => !url.pathname.startsWith('/admin/login'));

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'admin_session');
  const refresh = cookies.find((c) => c.name === 'admin_refresh');
  expect(session?.value, 'admin_session must survive the reload').toBeTruthy();
  expect(refresh?.value, 'admin_refresh must survive the reload').toBeTruthy();
});
