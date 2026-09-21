import { expect, test, type Page } from '@playwright/test';

/**
 * A5 — `?next=` is honoured after admin login (mocks-on).
 *
 * The mock session accepts any email, any 8+ character password and any
 * 6-digit code, so these drive the real login page and the real sanitiser,
 * not the backend.
 */

async function mockLogin(page: Page) {
  await page.getByLabel('Email').fill('ops@towing.local');
  await page.getByLabel('Password', { exact: true }).fill('AdminPass123!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('visiting /admin/finance logged out lands back on /admin/finance after login', async ({
  page,
}) => {
  await page.goto('/admin/finance');
  await expect(page).toHaveURL(/\/admin\/login\?next=/);

  await mockLogin(page);

  await expect(page).toHaveURL(/\/admin\/finance/);
  await expect(page.getByRole('heading', { name: 'Payout approvals' })).toBeVisible();
});

test('?next=//evil.example falls back to /admin, staying same-origin', async ({ page }) => {
  await page.goto('/admin/login?next=//evil.example');
  await mockLogin(page);

  // Wait until the login `?next=` is gone — i.e. the redirect after sign-in
  // has happened — before asserting on the URL.
  await page.waitForURL((url) => !url.searchParams.has('next'));
  const url = new URL(page.url());
  expect(url.hostname).toBe('localhost');
  expect(url.pathname.startsWith('/admin')).toBe(true);
  expect(page.url()).not.toContain('evil.example');
});

test('a ?next= containing a backslash falls back to /admin', async ({ page }) => {
  // `/admin/\evil.example` passes the prefix rule (so this exercises the
  // backslash rule, not the prefix one — the old value never reached it).
  await page.goto('/admin/login?next=/admin/%5Cevil.example');
  await mockLogin(page);

  await page.waitForURL((url) => !url.searchParams.has('next'));
  const url = new URL(page.url());
  expect(url.hostname).toBe('localhost');
  expect(url.pathname.startsWith('/admin')).toBe(true);
});

test('a ?next= with a dot-dot segment falls back to /admin', async ({ page }) => {
  await page.goto('/admin/login?next=/admin/../login');
  await mockLogin(page);

  await page.waitForURL((url) => !url.searchParams.has('next'));
  const url = new URL(page.url());
  expect(url.hostname).toBe('localhost');
  expect(url.pathname).toBe('/admin');
  expect(page.url()).not.toContain('..');
});
