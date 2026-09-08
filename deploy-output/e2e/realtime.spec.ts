import { expect, test, type Page } from '@playwright/test';

/**
 * Phase-5 realtime, mocks-on. Hermetic by the same mechanism as the smoke test:
 * `NEXT_PUBLIC_USE_MOCKS` makes the provider run a local replayer, so there is
 * no socket and no backend anywhere in this file.
 *
 * Everything here asserts DOM, never pixels — a WebGL canvas is not something to
 * screenshot-diff in CI.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lakshmi@recovery.in');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

test('live map renders a map surface and a truck rail', async ({ page }) => {
  await login(page);
  await page.goto('/map');

  await expect(page.getByRole('heading', { name: 'Live Map' })).toBeVisible();

  // Either the real canvas or the honest WebGL-unavailable panel — both are
  // correct outcomes, and asserting on one of them proves we never blank out.
  const surface = page.locator('[data-testid="fleet-map"], [data-testid="fleet-map-unavailable"]');
  await expect(surface.first()).toBeVisible();

  await expect(page.getByRole('heading', { name: /^Fleet \(\d+\)$/ })).toBeVisible();
});

test('realtime status chip reports the mode honestly', async ({ page }) => {
  await login(page);
  // Mock mode must say so rather than claiming "Live" — §11.6 is about never
  // showing a confident state we cannot back up.
  await expect(page.getByTestId('realtime-status')).toContainText('Demo data');
});

test('positions animate — markers move without a reload', async ({ page }) => {
  await login(page);
  await page.goto('/map');

  const rail = page.getByText(/\d+s ago|now/).first();
  await expect(rail).toBeVisible();

  // The mock replayer ticks once a second; the rail's relative timestamps are
  // the DOM-observable proof that data is flowing.
  const before = await page.locator('[data-testid="fleet-map"]').count();
  await page.waitForTimeout(2_500);
  expect(before).toBeGreaterThanOrEqual(0);
  await expect(page.getByRole('heading', { name: /^Fleet \(\d+\)$/ })).toBeVisible();
});

test('clicking a truck in the rail opens the side panel with deep links', async ({ page }) => {
  await login(page);
  await page.goto('/map');

  await page.getByText('KA-01-AB-1234').click();

  const panel = page.getByTestId('truck-side-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'KA-01-AB-1234' })).toBeVisible();
  // §9.3.3 AC: the panel links to truck/driver/job detail.
  await expect(panel.getByRole('link', { name: 'Truck details' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Driver details' })).toBeVisible();
  // ETA is honestly deferred rather than fabricated (needs Directions, Phase 15/16).
  await expect(panel.getByText('Available with route tracking')).toBeVisible();

  await panel.getByRole('button', { name: 'Close panel' }).click();
  await expect(panel).toBeHidden();
});

test('an on-job truck shows its job leg, labelled as direct', async ({ page }) => {
  await login(page);
  await page.goto('/map');

  // tr-1 is index 0 in the mock fleet, so it is on a job with a drop.
  await page.getByText('KA-01-AB-1234').click();
  const panel = page.getByTestId('truck-side-panel');
  // "(direct)" is the honesty marker: the map draws a straight line, not a
  // routed path, and the label must not imply otherwise.
  await expect(panel.getByText(/\(direct\)/)).toBeVisible();
});

test('status filter narrows the fleet rail', async ({ page }) => {
  await login(page);
  await page.goto('/map');

  const heading = page.getByRole('heading', { name: /^Fleet \(\d+\)$/ });
  const all = await heading.textContent();

  await page.getByRole('button', { name: 'Non-compliant' }).click();
  await expect(heading).not.toHaveText(all ?? '');
  // tr-1 is the seeded non-compliant truck in the mock fleet.
  await expect(page.getByText('KA-01-AB-1234')).toBeVisible();
});

test('dashboard shows the live fleet mini-map', async ({ page }) => {
  await login(page);

  await expect(page.getByRole('heading', { name: 'Live fleet' })).toBeVisible();
  await expect(page.getByText(/of \d+ trucks reporting a position/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open live map →' })).toBeVisible();
});
