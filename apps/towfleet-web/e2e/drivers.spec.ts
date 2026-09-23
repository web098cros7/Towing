import { expect, test } from '@playwright/test';
import { login } from './support/login';

/**
 * ADM-23's per-driver performance panel, mocks-on. The real numbers (this
 * fleet's jobs only, earnings net of refunds) and the other-fleet 404 are
 * asserted in the backend's `drivers.e2e.spec.ts`.
 */
test('a driver row opens their performance panel, and a recent job opens its page', async ({
  page,
}) => {
  await login(page);
  await page.goto('/drivers');
  await page.getByText('Suresh Kumar').click();

  const panel = page.getByTestId('driver-performance');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Trips finished');
  await expect(panel).toContainText("Your fleet's share");

  await page.getByTestId('driver-recent-jobs').getByText('TW-88102').click();
  await expect(page).toHaveURL(/\/jobs\/tw-88102$/);
});
