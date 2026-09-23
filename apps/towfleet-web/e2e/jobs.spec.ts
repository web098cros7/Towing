import { expect, test } from '@playwright/test';
import { login } from './support/login';

/**
 * ADM-23's job page, mocks-on: a fleet owner opens a job from the list and
 * can answer "why did I earn this on that job?": the fare, where the money
 * went, and what happened when. The real split (read from the ledger) and the
 * other-fleet 404 are asserted in the backend's `jobs.e2e.spec.ts`.
 */
test('a job row opens its page, with the split and the timeline', async ({ page }) => {
  await login(page);
  await page.goto('/jobs');

  // TW-88102 is a paid flatbed tow in the fixture: settled, so the shares show.
  await page.getByText('TW-88102').click();
  await expect(page).toHaveURL(/\/jobs\/tw-88102$/);

  await expect(page.getByRole('heading', { name: 'TW-88102' })).toBeVisible();
  const split = page.getByTestId('job-split');
  await expect(split).toContainText('Customer paid');
  await expect(split).toContainText('MiTow commission (10%, band A)');
  await expect(split).toContainText("Your fleet's share");
  await expect(page.getByTestId('job-timeline').locator('li')).toHaveCount(6);
});

test('an unsettled job says so instead of showing shares', async ({ page }) => {
  await login(page);
  // TW-88121 is still en route.
  await page.goto('/jobs/tw-88121');
  await expect(page.getByTestId('job-split')).toContainText('Not settled yet');
});
