import { expect, test } from '@playwright/test';
import { login } from './support/login';

/**
 * 0042: the owner decides how their drivers are paid, mocks-on. What
 * settlement actually pays under each choice is asserted in the backend's
 * `fleet-driver-pay.e2e.spec.ts`.
 */
test('the owner switches the fleet to salary and back to a share', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  const card = page.getByTestId('driver-pay-card');
  await expect(card).toBeVisible();
  await expect(card.getByLabel("Driver's share of each job (%)")).toHaveValue('80');

  await card.getByLabel('Keep it all, pay a salary').check();
  await expect(card.getByLabel("Driver's share of each job (%)")).toHaveCount(0);
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('status')).toHaveText('Saved');

  await card.getByLabel('Share each job').check();
  await card.getByLabel("Driver's share of each job (%)").fill('120');
  await expect(card).toContainText('Enter a number from 0 to 100');
  await expect(card.getByRole('button', { name: 'Save' })).toBeDisabled();

  await card.getByLabel("Driver's share of each job (%)").fill('70');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('status')).toHaveText('Saved');
});

test("the owner gives one driver their own share, then puts them back on the fleet's", async ({
  page,
}) => {
  await login(page);
  await page.goto('/drivers');
  await page.getByText('Suresh Kumar').click();

  const section = page.getByTestId('driver-share');
  await expect(section).toContainText("fleet's default share: 80%");

  await section.getByLabel("Suresh Kumar's share of each job (%)").fill('60');
  await section.getByRole('button', { name: 'Save share' }).click();
  await expect(section).toContainText('Suresh Kumar gets 60% of each job');

  await section.getByRole('button', { name: 'Use fleet default' }).click();
  await expect(section).toContainText("fleet's default share: 80%");
});
