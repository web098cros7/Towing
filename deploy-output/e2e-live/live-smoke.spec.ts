import { expect, test } from '@playwright/test';
import { liveLogin } from './support/live-login';

/**
 * The console driven end to end against a REAL backend, through a proxy that
 * round-robins every request across two Next processes and two API processes.
 *
 * Deliberately NOT the hermetic suite run with mocks off. Those specs assert
 * mock-shaped data — `KA-01-AB-1234`, specific KPI numbers, a specific alert
 * list — which the seed does not reproduce, so pointing them at a live stack
 * would produce a wall of failures that say nothing about statelessness. These
 * assert only what must be true of any seeded fleet, which is what makes them
 * meaningful across two of everything.
 */
test.describe('live console (mocks off, two instances)', () => {
  test.beforeEach(async ({ page }) => {
    await liveLogin(page);
  });

  test('dashboard renders real KPIs from the database', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Shape, not exact values: the seed is deterministic but this asserts the
    // data came from somewhere real, not that it matched a fixture.
    const revenue = page.getByText(/₹/).first();
    await expect(revenue).toBeVisible();
  });

  test('trucks, drivers and jobs all load across round-robined instances', async ({ page }) => {
    // Each navigation is several requests, and consecutive requests land on
    // DIFFERENT backends. Anything held in one process — a session, a cache a
    // handler assumed was warm — surfaces here as an empty screen or a 500.
    await page.goto('/trucks');
    await expect(page.getByRole('heading', { name: 'Trucks' })).toBeVisible();
    await expect(page.getByText(/KA-|TN-/).first()).toBeVisible();

    await page.goto('/drivers');
    await expect(page.getByRole('heading', { name: 'Drivers' })).toBeVisible();

    await page.goto('/jobs');
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  });

  test('earnings reads the ledger and the projection', async ({ page }) => {
    await page.goto('/earnings');
    await expect(page.getByRole('heading', { name: 'Earnings & Payouts' })).toBeVisible();
    await expect(page.getByText(/₹/).first()).toBeVisible();
  });

  test('signing out clears the session on whichever instance serves it', async ({ page }) => {
    await page.getByRole('button', { name: /sign out|log out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    // The cookie is httpOnly and cleared by the BFF; a protected route must now
    // redirect regardless of which Next process handles the request.
    await page.goto('/trucks');
    await expect(page).toHaveURL(/\/login/);
  });
});
