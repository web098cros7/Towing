import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W17's analytics console, hermetic (mocks-on).
 *
 * The mock is DETERMINISTIC by index, so these assertions are stable across
 * runs — same day, same numbers. Charts are asserted by their containers
 * (recharts needs a laid-out box; a headless race on SVG paths would be a
 * flake, not a finding), and the export links are asserted as LINKS with the
 * proxy path, because that byte stream is the backend spec's job.
 */

test('the summary tab shows KPIs, charts and export links', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/analytics');

  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByText('GMV', { exact: true })).toBeVisible();
  await expect(page.getByText('Fill rate', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('chart-bookings')).toBeVisible();
  await expect(page.getByTestId('chart-gmv')).toBeVisible();

  const exportLink = page.getByTestId('export-summary');
  await expect(exportLink).toBeVisible();
  await expect(exportLink).toHaveAttribute(
    'href',
    /\/api\/admin-proxy\/analytics\/export\.csv\?dataset=summary/,
  );
  await expect(page.getByTestId('export-revenue')).toBeVisible();
});

test('the marketplace tab charts fill rate and time-to-match', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/analytics');

  await page.getByTestId('tab-marketplace').click();
  await expect(page.getByTestId('chart-fill')).toBeVisible();
  await expect(page.getByTestId('chart-ttm')).toBeVisible();
  await expect(page.getByTestId('chart-active-drivers')).toBeVisible();
});

test('the revenue tab shows the band table and the take-rate chart', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/analytics');

  await page.getByTestId('tab-revenue').click();
  await expect(page.getByTestId('chart-revenue')).toBeVisible();
  await expect(page.getByTestId('chart-take-rate')).toBeVisible();

  const bandA = page.getByTestId('band-A');
  await expect(bandA).toBeVisible();
  await expect(bandA).toContainText('A');
  await expect(bandA).toContainText('₹');
});

test('the drivers tab shows the rating distribution', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/analytics');

  await page.getByTestId('tab-drivers').click();
  await expect(page.getByTestId('chart-ratings')).toBeVisible();
  await expect(page.getByTestId('chart-driver-activity')).toBeVisible();
  await expect(page.getByText('Avg acceptance')).toBeVisible();
});

test('the geo tab renders the heatmap container, metric switch and zone table', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/analytics');

  await page.getByTestId('tab-geo').click();
  await expect(page.getByTestId('analytics-heatmap')).toBeVisible();

  await page.getByTestId('geo-metric').selectOption('noDrivers');
  // Three zone rows share the name (one per day) — strict mode wants one.
  await expect(page.getByText('Contract Ops Zone').first()).toBeVisible();
  await expect(page.getByText('No drivers', { exact: true })).toBeVisible();
});
