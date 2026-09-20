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

test('renders every KPI tile from the mock day', async ({ page }) => {
  await adminLogin(page);

  await expect(page.getByText('Active rides')).toBeVisible();
  await expect(page.getByText('2 searching now')).toBeVisible();
  await expect(page.getByText('11 dispatchable now')).toBeVisible();
  // 845000 paise → ₹8,450; 126750 → ₹1,267.50 (the formatter's two cases).
  await expect(page.getByText('₹8,450')).toBeVisible();
  await expect(page.getByText('₹1,267.50')).toBeVisible();
  await expect(page.getByText('92.5%')).toBeVisible();
  await expect(page.getByText('42s')).toBeVisible();
  await expect(page.getByText('p90 128s')).toBeVisible();
  await expect(page.getByText('KYC 4 · Payouts 2')).toBeVisible();
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
