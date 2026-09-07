import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * Phase 11 admin console, hermetic (mocks-on): realm separation and the queue
 * UI render. The real signed-GET/approve round trip is proven mocks-off in
 * `e2e-live/admin-kyc.spec.ts` — a mock mutation here would only prove the
 * mock data source resolves, not that the backend contract holds.
 */

test('an unauthenticated visitor hitting /admin is redirected to /admin/login', async ({ page }) => {
  await page.goto('/admin/drivers');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('heading', { name: 'Towing Admin' })).toBeVisible();
});

test('the fleet session does not authenticate the admin console (realm separation)', async ({
  page,
}) => {
  // Log into the FLEET console first.
  await page.goto('/login');
  await page.getByLabel('Email').fill('lakshmi@recovery.in');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');

  // A fleet session cookie must not open the admin console.
  await page.goto('/admin/drivers');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('admin login → KYC queue renders, and a submitted driver has a real drawer', async ({ page }) => {
  // Hoisted into `support/adminLogin.ts` in Phase 19, when §9.4.10's Finance
  // queue became the console's second spec — the same move `support/login.ts`
  // made for the fleet console once it had two.
  await adminLogin(page);

  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();
  await expect(page.getByText('Prakash Naik')).toBeVisible();

  await page.getByText('Prakash Naik').click();
  await expect(page.getByRole('heading', { name: 'Prakash Naik' })).toBeVisible();
  await expect(page.getByText('Driving licence')).toBeVisible();
  await expect(page.getByTestId('kyc-decide-approve')).toBeVisible();
  await expect(page.getByTestId('kyc-decide-reject')).toBeVisible();
  await expect(page.getByTestId('kyc-decide-request-info')).toBeVisible();

  // Security regression: a `..`-laden path segment must not reach the proxy
  // handler at all. Next's catch-all matcher hands a percent-encoded slash
  // through as ONE already-decoded segment (`../fleet/whatever`, not two), so
  // a naive `segments.join('/')` would let `fetch()`'s URL parser collapse it
  // against the realm prefix and smuggle the request to the OTHER realm's
  // upstream path. `createProxyHandler` now 404s any segment that is exactly
  // `..`, `.`, or empty before it ever builds the upstream URL.
  const smuggled = await page.request.get('/api/admin-proxy/..%2Ffleet%2Fdashboard');
  expect(smuggled.status()).toBe(404);
});
