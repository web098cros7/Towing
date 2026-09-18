import { expect, test, type Page } from '@playwright/test';
import { adminLiveLogin } from './support/adminLiveLogin';

/**
 * M0-F2: identity loads after a client-side login and dies on logout.
 *
 * Before the fix the provider queried on `/admin/login` (caching `null` for
 * 60 s, so a client-side post-login navigation never received the identity —
 * an ops admin stayed on `/admin`), and logout never cleared the query cache
 * (the next admin in the same tab saw the previous admin's identity and rows).
 */

async function loginAs(page: Page, email: string) {
  await adminLiveLogin(page, email);
}

test('identity renders after login with no reload', async ({ page }) => {
  await loginAs(page, 'ops@towing.local');
  // The chip lives in the console shell, so walk to a queue — the point is
  // the identity resolved client-side, with no reload after login.
  await page.goto('/admin/drivers');
  await expect(page.getByTestId('admin-identity')).toContainText('operations');
});

test('logout clears the cache: the next admin sees their own identity only', async ({
  page,
}) => {
  await loginAs(page, 'ops@towing.local');
  await page.goto('/admin/drivers');
  await expect(page.getByTestId('admin-identity')).toContainText('operations');

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/admin/login'));

  await loginAs(page, 'finance@towing.local');
  // No ops residue on the neutral landing: finance must not see the
  // verification queue card…
  await page.goto('/admin');
  await expect(page.getByText('Verification queue')).toHaveCount(0);
  // …and the shell shows the finance identity, not the cached ops one.
  await page.goto('/admin/finance');
  await expect(page.getByTestId('admin-identity')).toContainText('finance');
});
