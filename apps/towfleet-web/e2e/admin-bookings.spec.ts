import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W8's bookings console, hermetic (mocks-on).
 *
 * RENDERS AND CLIENT-SIDE VALIDATION ONLY, per the house rule
 * `admin-kyc.spec.ts` states: a mock mutation would only prove the mock data
 * source resolves. Cancel/reassign/override change money and dispatch state —
 * their round trips belong in `e2e-live/`, against a real booking.
 *
 * The §14.2 fixture is the reason this file exists in the shape it does:
 * booking `TW-3C4D5E6F` is COMPLETED with a failed booking payment, which is
 * the only state that offers Recheck and Remind.
 */

const UNPAID_BOOKING = '33333333-3333-4333-8333-333333333333';
const PAID_BOOKING = '44444444-4444-4444-8444-444444444444';

test('the list renders bookings with their parties and money', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/bookings');

  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible();
  await expect(page.getByText('TW-1A2B3C4D')).toBeVisible();
  await expect(page.getByText('Ramesh Kumar')).toBeVisible();
  // The §14.2 row is only meaningful if the list can reach it.
  await expect(page.getByText('TW-3C4D5E6F')).toBeVisible();
});

test('status chips narrow the list, and "live problems" is one click', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/bookings');

  await page.getByTestId('bookings-status-paid').click();
  await expect(page.getByText('Lakshmi Devi')).toBeVisible();
  await expect(page.getByText('Ramesh Kumar')).toHaveCount(0);

  // The chip is any-of searching + no_drivers_found — the two statuses an Ops
  // operator watches during peak.
  await page.getByTestId('bookings-status-paid').click();
  await page.getByTestId('bookings-live-problems').click();
  await expect(page.getByText('Neha Gupta')).toBeVisible();
  await expect(page.getByText('Ramesh Kumar')).toHaveCount(0);
});

test('search finds a booking by code', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/bookings');

  await page.getByTestId('bookings-search').fill('TW-3C4D5E6F');
  await expect(page.getByText('Vikram Rao')).toBeVisible();
  await expect(page.getByText('TW-1A2B3C4D')).toHaveCount(0);
});

test('the detail shows the frozen snapshot, the failed payment, and the §14.2 pair', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto(`/admin/bookings/${UNPAID_BOOKING}`);

  await expect(page.getByRole('heading', { name: 'TW-3C4D5E6F' })).toBeVisible();
  await expect(page.getByTestId('booking-total')).toHaveText('₹960');

  // Completed + booking payment failed: the unpaid intervention is the whole
  // point of this screen.
  await expect(page.getByTestId('booking-action-recheck')).toBeVisible();
  await expect(page.getByTestId('booking-action-remind')).toBeVisible();
  await expect(page.getByText('Customer abandoned the payment sheet')).toBeVisible();

  // Timeline renders the ladder with the admin-actor column wired.
  await expect(page.getByTestId('booking-timeline')).toBeVisible();
});

test('a paid booking offers the invoice instead of the unpaid interventions', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/bookings/${PAID_BOOKING}`);

  // The invoice is minted on demand — clicking is what asks for the audited
  // link (`booking.invoice.view`), so the fetch must not happen on load.
  await expect(page.getByTestId('booking-action-recheck')).toHaveCount(0);
  await page.getByTestId('booking-action-invoice').click();
  await expect(page.getByTestId('booking-invoice-link')).toHaveAttribute(
    'href',
    /mock\.towing\.local/,
  );
});

test('cancel refuses an under-length reason and asks about the fee', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/bookings/11111111-1111-4111-8111-111111111111`);

  await page.getByTestId('booking-action-cancel').click();
  const submit = page.getByTestId('booking-cancel-submit');
  await expect(submit).toBeDisabled();

  await page.getByTestId('booking-cancel-reason').fill('no');
  await expect(submit).toBeDisabled();

  await page.getByTestId('booking-cancel-reason').fill('Customer asked to cancel the tow');
  await expect(submit).toBeEnabled();

  // G4: waive is the default, and the policy mode is a deliberate choice.
  await expect(page.getByTestId('booking-cancel-fee-mode')).toHaveValue('waive');
  await page.getByTestId('booking-cancel-fee-mode').selectOption('apply_policy');
  await expect(page.getByTestId('booking-cancel-fee-mode')).toHaveValue('apply_policy');
  await expect(page.getByTestId('booking-cancel-compensate')).not.toBeChecked();
});

test('reassign gates the driver pick on the exclusive mode', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/bookings/11111111-1111-4111-8111-111111111111`);

  await page.getByTestId('booking-action-reassign').click();
  const submit = page.getByTestId('booking-reassign-submit');

  // Redispatch needs no driver — only the reason.
  await expect(page.getByTestId('booking-reassign-driver')).toHaveCount(0);
  await page.getByTestId('booking-reassign-reason').fill('Driver stuck in traffic');
  await expect(submit).toBeEnabled();

  // Exclusive mode brings the picker back, and the pick becomes mandatory.
  await page.getByTestId('booking-reassign-mode').selectOption('offer_to_driver');
  await expect(page.getByTestId('booking-reassign-driver')).toBeVisible();
  await expect(submit).toBeDisabled();

  await page.getByTestId('booking-reassign-driver').selectOption({ label: 'Suresh Nair' });
  await expect(submit).toBeEnabled();

  // The fault flag is the honest one: it decides `unable` vs `reassigned`.
  await expect(page.getByTestId('booking-reassign-fault')).not.toBeChecked();
});

test('A18: the override is super-admin-only, and the dispute dialog pins its origin', async ({
  page,
}) => {
  await adminLogin(page);
  // The mock identity is `operations`, which holds booking.cancel/reassign but
  // not booking.override — the button must be absent, not disabled.
  await page.goto(`/admin/bookings/${UNPAID_BOOKING}`);
  await expect(page.getByTestId('booking-action-override')).toHaveCount(0);

  // A dispute opens from the booking; the dialog states the origin because the
  // available exits follow from it.
  await page.getByTestId('booking-action-dispute').click();
  const submit = page.getByTestId('open-dispute-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('open-dispute-description').fill('Halfway drop, tools still on the road');
  await expect(submit).toBeEnabled();
  await expect(page.getByText(/disputed/)).toBeVisible();
});

test('an unauthenticated visitor cannot reach the bookings console', async ({ page }) => {
  await page.goto('/admin/bookings');
  await expect(page).toHaveURL(/\/admin\/login/);
});
