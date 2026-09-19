import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W8's dispute queue, hermetic (mocks-on) — renders and client-side validation
 * only; the resolutions move money and belong to `e2e-live/`.
 *
 * The fixture carries one dispute per origin, which is what lets this file
 * assert the EXIT TABLE as a UI property: `uphold_charge` exists only for a
 * dispute opened from `paid`, `partial_refund` insists on amount + liability,
 * and nothing else takes either.
 */

const OPEN_DISPUTE = 'a1a1a1a1-1111-4111-8111-111111111111';
const COMPLETED_ORIGIN_DISPUTE = 'a2a2a2a2-2222-4222-8222-222222222222';

test('the queue defaults to open disputes and widens via the tabs', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/disputes');

  await expect(page.getByRole('heading', { name: 'Disputes' })).toBeVisible();
  await expect(page.getByText('TW-4D5E6F70')).toBeVisible();

  // d3 is resolved — it must NOT be in the working queue.
  await expect(page.getByText('TW-708192A3')).toHaveCount(0);
  await page.getByTestId('tab-resolved').click();
  await expect(page.getByText('TW-708192A3')).toBeVisible();
  await expect(page.getByText('partial refund')).toBeVisible();
});

test('the reason filter narrows to one code', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/disputes');

  await page.getByTestId('disputes-reason').selectOption('overcharge');
  await expect(page.getByText('TW-4D5E6F70')).toBeVisible();
  await expect(page.getByText('TW-8192A3B4')).toHaveCount(0);
});

test('a row opens the drawer with the booking link and the evidence', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/disputes');

  await page.getByText('TW-4D5E6F70').click();

  await expect(page.getByTestId('dispute-description')).toContainText('waiting charge');
  await expect(page.getByTestId('dispute-booking-link')).toHaveAttribute(
    'href',
    '/admin/bookings/44444444-4444-4444-8444-444444444444',
  );
  // Presigned URLs render as links; the raw key is never in the payload.
  await expect(page.getByTestId('dispute-evidence').locator('li')).toHaveCount(2);
});

test('the five exits are filtered by origin, and partial insists on amount + note', async ({
  page,
}) => {
  await adminLogin(page);
  // d1 opened from `paid` — the full exit set, including uphold_charge.
  await page.goto(`/admin/disputes?dispute=${OPEN_DISPUTE}`);

  await expect(page.getByTestId('resolve-exit-uphold_charge')).toBeVisible();

  // Partial reveals amount and liability; other exits hide both again.
  await page.getByTestId('resolve-exit-partial_refund').click();
  await expect(page.getByTestId('resolve-amount')).toBeVisible();
  await expect(page.getByTestId('resolve-liability')).toBeVisible();

  const submit = page.getByTestId('resolve-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('resolve-amount').fill('500');
  await expect(submit).toBeDisabled();
  await page.getByTestId('resolve-note').fill('Waiting time overbilled; refunding the difference');
  await expect(submit).toBeEnabled();

  await page.getByTestId('resolve-exit-uphold_charge').click();
  await expect(page.getByTestId('resolve-amount')).toHaveCount(0);
  await expect(submit).toBeEnabled();
});

test('a dispute opened from "completed" is not offered uphold_charge', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/disputes?dispute=${COMPLETED_ORIGIN_DISPUTE}`);

  // Nothing was captured on this origin, so there is no charge to uphold —
  // the A9 settlement guard is what makes the exit meaningful.
  await expect(page.getByTestId('resolve-exit-uphold_charge')).toHaveCount(0);
  await expect(page.getByTestId('resolve-exit-cancel_no_charge')).toBeVisible();
  await page.getByTestId('resolve-exit-cancel_no_charge').click();
  await expect(page.getByTestId('resolve-compensate')).toBeVisible();
});

test('an unassigned dispute offers "assign to me"', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/disputes?dispute=${OPEN_DISPUTE}`);

  await expect(page.getByTestId('dispute-assign-me')).toBeVisible();
});

test('an unauthenticated visitor cannot reach the dispute queue', async ({ page }) => {
  await page.goto('/admin/disputes');
  await expect(page).toHaveURL(/\/admin\/login/);
});
