import { expect, type Page } from '@playwright/test';

/**
 * The two-step admin login, hoisted.
 *
 * `admin-kyc.spec.ts` inlined this while it was the console's only spec —
 * reasonably, since there was nothing to share it with. §9.4.10's Finance queue
 * is the second, and the moment a login sequence exists twice is the moment
 * `support/login.ts` was hoisted for the fleet console in Track A Phase 7.
 *
 * `123456` is the fixed dev OTP; the suite is hermetic and runs mocks-on.
 */
export async function adminLogin(
  page: Page,
  credentials: { email?: string; password?: string } = {},
): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(credentials.email ?? 'ops@towing.local');
  await page.getByLabel('Password').fill(credentials.password ?? 'AdminPass123!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // A7 + M0-F7: `/admin` is neutral — no sub-role is redirected anywhere
  // (mock login is `operations`, so both queue cards show). Specs navigate on
  // to the queue they need. Wait for the post-login URL that is NOT the login
  // page: a bare `/\/admin/` also matches `/admin/login`, which fires the
  // next `goto` before verify's `Set-Cookie` lands (M0-F3's live race).
  await expect(page).toHaveURL(/\/admin$/);
}
