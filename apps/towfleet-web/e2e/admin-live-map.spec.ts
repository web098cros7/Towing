import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W4 — `/admin/ops` live map (mocks-on).
 *
 * Renders and client behaviour only: the mock console connects no socket on
 * purpose, and the room-join routing plus the `<2 s` ping→frame latency are
 * proven in the backend's `admin-zone-routing.e2e.spec.ts` and
 * `admin-realtime.e2e.spec.ts`. The surface assertion follows the fleet map's
 * rule — canvas OR its WebGL fallback, never a blank box.
 */

test('renders the map (or its fallback) with the driver and job rails', async ({ page }) => {
  await adminLogin(page);
  await page.getByTestId('admin-nav-ops').click();

  await expect(page).toHaveURL(/\/admin\/ops$/);

  const surface = page.locator('[data-testid="admin-map"], [data-testid="admin-map-unavailable"]');
  await expect(surface).toBeVisible();

  await expect(page.getByTestId('admin-rail-driver')).toHaveCount(3);
  await expect(page.getByText('Ravi Kumar')).toBeVisible();
  await expect(page.getByTestId('admin-rail-booking')).toHaveCount(2);
});

test('status and stale-only filters narrow the rails', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/ops');

  await expect(page.getByTestId('admin-rail-booking')).toHaveCount(2);

  // Scope to the filter bar: the rail's StatusChip also reads "En route".
  await page.getByTestId('admin-map-filters').getByRole('button', { name: 'En route' }).click();
  await expect(page.getByTestId('admin-rail-booking')).toHaveCount(1);

  // Every mock driver has pinged except one, so "stale only" leaves exactly
  // that one — the filter the operator uses to find quiet tracking.
  await page.getByRole('switch').click();
  await expect(page.getByTestId('admin-rail-driver')).toHaveCount(1);
  await expect(page.getByText('Deepa Nair')).toBeVisible();
  await expect(page.getByText('Ravi Kumar')).toHaveCount(0);
});

test('clicking a driver opens the details-only panel', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/ops');

  await page.getByRole('button', { name: /Ravi Kumar/ }).click();

  const panel = page.getByTestId('admin-driver-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Live position');
});
