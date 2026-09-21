import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminLiveLogin } from './support/adminLiveLogin';

/**
 * W2's second-factor life cycle, end to end in a browser against the live
 * backend: create an admin → enrol TOTP → sign in with an authenticator code,
 * then a forced password change from a reset → and the first authenticator
 * login.
 *
 * WHY IT CREATES ITS OWN ADMIN: the four seeded operators are used by the
 * other live specs' SMS logins, and enrolling TOTP for one of them would
 * change the login method under every later run. The new admin is disposable.
 *
 * TOTP is computed HERE (base32 + HMAC-SHA1, RFC 6238) rather than imported:
 * the spec runs from the web package, which does not depend on the backend's
 * otplib, and 25 lines is cheaper than a workspace dependency for one test.
 */

const BACKEND_URL = process.env.LIVE_BACKEND_URL ?? 'http://localhost:4000';
const STEP_SECONDS = 30;

function base32Decode(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value === -1) throw new Error(`bad base32 char ${char}`);
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string, epochMs = Date.now()): string {
  const counter = Math.floor(epochMs / 1000 / STEP_SECONDS);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return (code % 1_000_000).toString().padStart(6, '0');
}

const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS);

/** Waits for the next TOTP time step — a code from the confirm's own step is a replay. */
async function waitPastStep(step: number): Promise<void> {
  for (let i = 0; i < 40 && currentStep() <= step; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  expect(currentStep()).toBeGreaterThan(step);
}

/** Step 1 of the login: email + password, then read the challenge id. */
async function submitCredentials(page: Page, email: string, password: string): Promise<void> {
  const loginResponse = page.waitForResponse((res) => res.url().includes('/api/admin-session/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await (await loginResponse).json();
}

/** Full SMS login for an admin with no TOTP: pulls the code from the dev echo. */
async function smsSignIn(page: Page, email: string, password: string): Promise<void> {
  const loginResponse = page.waitForResponse((res) => res.url().includes('/api/admin-session/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  const { challengeId } = (await (await loginResponse).json()) as { challengeId: string };

  const otpRes = await page.request.get(
    `${BACKEND_URL}/v1/admin/auth/dev/otp?challengeId=${challengeId}`,
  );
  const { otp } = (await otpRes.json()) as { otp: string };

  const verifyResponse = page.waitForResponse((res) =>
    res.url().includes('/api/admin-session/verify'),
  );
  await page.getByLabel('One-time code').fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await verifyResponse;
  await page.waitForURL((url) => !url.pathname.startsWith('/admin/login'));
}

async function logout(page: Page): Promise<void> {
  // The neutral landing (`/admin`) is outside `(console)` and deliberately has
  // no topbar — post-login navigations land there, so park on a console page
  // that owns the logout control.
  if (!page.url().match(/\/admin\/.+/)) await page.goto('/admin/drivers');
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(/\/admin\/login/);
}

test('a new admin enrols TOTP, changes a reset password and signs in with a code', async ({ page }) => {
  const suffix = Date.now();
  const email = `totp-live-${suffix}@towing.test`;
  const newPassword = 'LiveTotpPass1';
  const finalPassword = 'LiveTotpPass2';

  // 1 · Create the admin as the super admin, and take the one-time password.
  await adminLiveLogin(page, 'super@towing.local');
  await page.goto('/admin/admins');
  await page.getByRole('button', { name: 'Create admin' }).click();
  await page.getByLabel('Name').fill(`TOTP Live ${suffix}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile').fill(`+9198${String(suffix).slice(-8)}`);
  await page.getByLabel('Sub-role').selectOption('operations');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  const tempPassword = await page.getByTestId('admin-temp-password').textContent();
  expect(tempPassword).toBeTruthy();
  await page.getByRole('button', { name: 'Done' }).click();

  // 2 · Sign in as the new admin (SMS) and enrol TOTP.
  await logout(page);
  await smsSignIn(page, email, tempPassword!);

  await page.goto('/admin/settings/security');
  const enrollResponse = page.waitForResponse((res) =>
    res.url().includes('/api/admin-proxy/auth/2fa/enroll'),
  );
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const { otpauthUri } = (await (await enrollResponse).json()) as { otpauthUri: string };
  const secret = new URL(otpauthUri).searchParams.get('secret');
  expect(secret).toBeTruthy();

  await page.getByLabel('Enter the code your app shows').fill(totp(secret!, Date.now() - 1_000));
  await page.getByRole('button', { name: 'Confirm and enable' }).click();
  await expect(page.getByRole('button', { name: 'Disable two-factor' })).toBeVisible();

  const confirmedStep = currentStep();

  // 3 · The super admin resets the new admin's password — which forces a
  // change on next login.
  await logout(page);
  await smsSignIn(page, 'super@towing.local', 'Password123!');
  await page.goto('/admin/admins');
  await page.getByText(`TOTP Live ${suffix}`).click();
  await page.getByRole('button', { name: 'Reset password' }).click();
  const resetTemp = await page.getByTestId('admin-temp-password').textContent();
  expect(resetTemp).toBeTruthy();
  await page.getByRole('button', { name: 'Close' }).click();

  // 4 · Signing in with the reset temp password never mints a session: the
  // page hands over to the change step, and the SAME challenge completes it.
  // The challenge is `totp` (the admin enrolled above), but the forced-change
  // check runs before any code verification — so any 6 digits reach it.
  await logout(page);
  await submitCredentials(page, email, resetTemp!);
  await page.getByLabel(/One-time code|Authenticator code/).fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#new-password')).toBeVisible();
  await page.locator('#new-password').fill(finalPassword);
  await page.locator('#confirm-password').fill(finalPassword);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/admin/login'));

  // 5 · And now the authenticator branch: the prompt is the app's code, and a
  // code from a step later than the enrolment confirm is accepted.
  await logout(page);
  await submitCredentials(page, email, finalPassword);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await waitPastStep(confirmedStep);
  await page.getByLabel('Authenticator code').fill(totp(secret!));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/admin/login'));
  // The identity chip lives in the console topbar, not on the neutral landing
  // the login flow lands on.
  await page.goto('/admin/drivers');
  await expect(page.getByTestId('admin-identity')).toContainText('operations');
});
