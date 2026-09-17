import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * A6 — one neutral landing page (mocks-on).
 *
 * No sub-role routing yet (that needs A7's identity): the point is that
 * landing on `/admin` drops nobody onto a queue — every admin picks one.
 */

test('logging in with no ?next= lands on the neutral /admin page', async ({ page }) => {
  await adminLogin(page);

  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Verification queue/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Payout approvals/ })).toBeVisible();
});

test('an unauthenticated visitor hitting /admin is redirected to /admin/login', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('the landing links reach both queues', async ({ page }) => {
  await adminLogin(page);

  await page.getByRole('link', { name: /Verification queue/ }).click();
  await expect(page).toHaveURL(/\/admin\/drivers/);
  await expect(page.getByRole('heading', { name: 'KYC queue' })).toBeVisible();

  await page.goto('/admin');
  await page.getByRole('link', { name: /Payout approvals/ }).click();
  await expect(page).toHaveURL(/\/admin\/finance/);
  await expect(page.getByRole('heading', { name: 'Payout approvals' })).toBeVisible();
});
