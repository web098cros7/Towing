import { expect, request as playwrightRequest, type Page } from '@playwright/test';

/**
 * The real §16.4 two-step login, against a real backend.
 *
 * The hermetic suite can type any six digits because mocks-on accepts them.
 * Here the OTP is genuinely random and genuinely checked, so the test has to
 * obtain it — which is what the development-only echo endpoint exists for. It
 * requires `AUTH_DEV_OTP_ECHO=true` on the backend, and production refuses to
 * boot with that set.
 *
 * The challenge id is read off the BFF's own response rather than the database:
 * the browser is already given it (the OTP step needs it), so intercepting the
 * response keeps this test to things a client can legitimately see.
 */
export async function liveLogin(
  page: Page,
  credentials: { email: string; password: string } = {
    email: 'lakshmi@recovery.in',
    password: 'Password123!',
  },
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);

  const [loginResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/session/login')),
    page.getByRole('button', { name: 'Continue' }).click(),
  ]);

  const { challengeId } = (await loginResponse.json()) as { challengeId: string };
  expect(challengeId, 'the BFF must return a challenge id').toBeTruthy();

  await page.getByLabel('One-time code').fill(await fetchDevOtp(challengeId));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

async function fetchDevOtp(challengeId: string): Promise<string> {
  const apiBaseUrl = process.env.LIVE_API_BASE_URL ?? 'http://localhost:4000';
  const context = await playwrightRequest.newContext();

  try {
    const res = await context.get(
      `${apiBaseUrl}/v1/fleet/auth/dev/otp?challengeId=${challengeId}`,
    );

    if (!res.ok()) {
      throw new Error(
        `dev OTP echo returned ${res.status()} — is the backend running with AUTH_DEV_OTP_ECHO=true? (see docs/rehearsal.md)`,
      );
    }

    return ((await res.json()) as { otp: string }).otp;
  } finally {
    await context.dispose();
  }
}
