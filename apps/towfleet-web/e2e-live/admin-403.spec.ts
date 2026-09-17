import { expect, test, type Page } from '@playwright/test';

/**
 * A7's 403 panel, mocks-off: real RBAC refusals render an explanation.
 *
 * `support` may read the KYC queue but not the finance queue; `finance` may
 * read payouts but not the KYC queue (`@Roles` on the controllers). Both
 * refusals must read as access-denied, never "something went wrong". Needs
 * `pnpm db:reset` state only insofar as the seeded admins exist.
 */

const BACKEND_URL = process.env.LIVE_BACKEND_URL ?? 'http://localhost:4000';

async function loginAs(page: Page, email: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Continue' }).click();

  const challengeIdMatch = await page.waitForResponse((res) =>
    res.url().includes('/api/admin-session/login'),
  );
  const { challengeId } = (await challengeIdMatch.json()) as { challengeId: string };

  const otpRes = await page.request.get(
    `${BACKEND_URL}/v1/admin/auth/dev/otp?challengeId=${challengeId}`,
  );
  const { otp } = (await otpRes.json()) as { otp: string };

  await page.getByLabel('One-time code').fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test('a support admin sees an explanation on the finance queue', async ({ page }) => {
  await loginAs(page, 'support@towing.local');
  await page.goto('/admin/finance');

  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  await expect(page.getByText(/don't have access to payout approvals/)).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
});

test('a finance admin sees an explanation on the KYC queue', async ({ page }) => {
  await loginAs(page, 'finance@towing.local');
  await page.goto('/admin/drivers');

  await expect(page.getByTestId('admin-forbidden')).toBeVisible();
  await expect(page.getByText(/don't have access to the verification queue/)).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
});
