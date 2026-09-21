import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W3 — the `/admin` ops dashboard (mocks-on).
 *
 * Renders only: the mock console connects no socket on purpose, and the
 * push-patch path (`ops:metrics` → cached dashboard) is proven end-to-end in
 * the backend's `admin-ops-broadcaster.e2e.spec.ts`, which asserts the pushed
 * payload equals what REST serves. Values come from
 * `features/admin-ops/mocks/adminOps.mock.ts`.
 */

test('renders the live-now card and the range analytics from the mock day', async ({ page }) => {
  await adminLogin(page);

  // Live now: rides, drivers, approvals and SOS come from the mock day's KPIs.
  await expect(page.getByText('Active rides')).toBeVisible();
  await expect(page.getByText('2 searching')).toBeVisible();
  await expect(page.getByText('11 dispatchable')).toBeVisible();
  await expect(page.getByText('KYC 4 · Payouts 2')).toBeVisible();
  await expect(page.getByText('Ack p50 18s')).toBeVisible();

  // The range analytics replaced the single-day tiles, which remain only as the
  // fallback for an admin without analytics access.
  await expect(page.getByText('GMV and commission across the range')).toBeVisible();
  await expect(page.getByText('GMV share by distance band')).toBeVisible();
  await expect(page.getByText('Fill rate')).toBeVisible();
});

test('renders the live activity feed with a row per source kind', async ({ page }) => {
  await adminLogin(page);

  // Four since W14: the feed carries SOS alerts alongside bookings and admin
  // actions, because an incident is exactly what this list is for.
  await expect(page.getByTestId('admin-activity-item')).toHaveCount(4);
  await expect(page.getByText(/New booking 00000000/)).toBeVisible();
  await expect(page.getByText(/Booking 00000000 → assigned/)).toBeVisible();
  await expect(page.getByText('driver.kyc.approve (driver)')).toBeVisible();
  await expect(page.getByText('sos.triggered (user)')).toBeVisible();
});

test('carries ops badge counts into the sidebar', async ({ page }) => {
  await adminLogin(page);

  await expect(page.getByTestId('admin-nav-badge-verification')).toHaveText('4');
  // Operations does not hold `finance.read`, so the Finance item (and its
  // badge) is not rendered at all — the badge payload must not resurrect it.
  await expect(page.getByTestId('admin-nav-finance')).toHaveCount(0);
  await expect(page.getByTestId('admin-nav-badge-finance')).toHaveCount(0);
});
