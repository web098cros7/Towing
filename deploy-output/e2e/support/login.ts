import { expect, type Page } from '@playwright/test';

/**
 * The two-step §16.4 login, hermetic in mocks-on mode (any 6-digit OTP passes —
 * see `app/api/session/verify/route.ts`).
 *
 * Hoisted in Phase 7: this helper had been copy-pasted into every spec file,
 * and three more specs would have made five copies of it.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lakshmi@recovery.in');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}
