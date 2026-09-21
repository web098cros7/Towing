import { type Page } from '@playwright/test';

/**
 * The one shared admin live-login (M0-F3).
 *
 * The old specs awaited `toHaveURL(/\/admin/)`, which ALSO matches
 * `/admin/login` — so the next `page.goto` fired before verify's
 * `Set-Cookie` landed and middleware bounced it. This helper instead awaits
 * the verify RESPONSE and then a URL that is no longer the login page, so
 * every caller continues with the session cookies actually set. Waiters are
 * registered BEFORE the clicks that trigger them.
 */

const BACKEND_URL = process.env.LIVE_BACKEND_URL ?? 'http://localhost:4000';

export async function adminLiveLogin(page: Page, email: string): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Password123!');

  const loginResponse = page.waitForResponse((res) =>
    res.url().includes('/api/admin-session/login'),
  );
  const verifyResponse = page.waitForResponse((res) =>
    res.url().includes('/api/admin-session/verify'),
  );
  await page.getByRole('button', { name: 'Continue' }).click();

  const { challengeId } = (await (await loginResponse).json()) as { challengeId: string };

  // The dev-OTP-echo route exists so a browser test never scrapes a log.
  // Called directly against the backend — nothing shipped proxies it.
  const otpRes = await page.request.get(
    `${BACKEND_URL}/v1/admin/auth/dev/otp?challengeId=${challengeId}`,
  );
  const { otp } = (await otpRes.json()) as { otp: string };

  await page.getByLabel('One-time code').fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await verifyResponse;
  await page.waitForURL((url) => !url.pathname.startsWith('/admin/login'));
}
