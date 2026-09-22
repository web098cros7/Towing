import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W12's dispatch + app-config screen, hermetic (mocks-on).
 *
 * RENDERS AND CLIENT-SIDE VALIDATION ONLY, per the house rule. What the page
 * exists to make safe is exactly what a mock cannot prove — a paused zone really
 * refusing bookings, a force-polling switch really 503ing tickets — so those
 * belong to `admin-dispatch.e2e.spec.ts` (config) and the A10–A12 specs
 * (behaviour). This file pins the weights validator, the confirmations and the
 * banner preview.
 *
 * The mock identity is `operations`, who hold `dispatch.config`.
 */

test('renders the launch weights, cadence, zones, switches and no banner', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/dispatch');

  await expect(page.getByRole('heading', { name: 'Dispatch' })).toBeVisible();

  // §6.2 weights and the sum the scorer normalises against.
  await expect(page.getByTestId('weight-proximity')).toHaveValue('60');
  await expect(page.getByTestId('weight-rating')).toHaveValue('15');
  await expect(page.getByTestId('weights-sum')).toContainText('100 / 100');

  // W12's knobs, at the values every handset has been told since Phase 16.
  await expect(page.getByTestId('ping-on-job')).toHaveValue('3000');
  await expect(page.getByTestId('ping-idle')).toHaveValue('10000');
  await expect(page.getByTestId('redispatch-priority')).toHaveValue('front');

  // The tuned zone carries an override badge; the untouched one does not — and
  // the untouched one shows no Clear button, because there is nothing to clear.
  await expect(page.getByTestId('zone-bengaluru-metro')).toContainText('override');
  await expect(page.getByTestId('zone-nh-44-corridor')).toContainText('defaults');
  await expect(page.getByTestId('zone-clear-nh-44-corridor')).toHaveCount(0);
  await expect(page.getByTestId('zone-clear-bengaluru-metro')).toBeVisible();

  // All three kill switches are off.
  await expect(page.getByTestId('pause-zone-bengaluru-metro')).toBeVisible();
  await expect(page.getByTestId('kill-force-polling')).toBeVisible();

  // §19.9: no incident, so no banner to preview.
  await expect(page.getByTestId('sev-preview')).toContainText('No banner');
});

test('the weights validator refuses anything that does not sum to 100', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/dispatch');

  await page.getByTestId('weight-proximity').fill('50');
  await expect(page.getByTestId('weights-sum')).toContainText('90 / 100');
  await expect(page.getByTestId('dispatch-save')).toBeDisabled();

  // Back to a total of 100 — the scorer normalises against that number, so
  // anything else silently rescales every candidate's score.
  await page.getByTestId('weight-proximity').fill('60');
  await expect(page.getByTestId('weights-sum')).toContainText('100 / 100');
  await expect(page.getByTestId('dispatch-save')).toBeEnabled();
});

test('editing a zone ladder validates ascending kilometres before saving', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/dispatch');

  const ladder = page.getByTestId('ladder-bengaluru-metro');
  await ladder.fill('5, 2, 10');
  await page.getByTestId('zone-save-bengaluru-metro').click();
  await expect(page.getByTestId('zone-ladder-error')).toContainText('ascending');

  // Correcting the ladder clears the complaint without a round trip.
  await ladder.fill('2, 4, 7');
  await expect(page.getByTestId('zone-ladder-error')).toHaveCount(0);
});

test('pausing a zone asks first, and says what pausing does', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/dispatch');

  await page.getByTestId('pause-zone-bengaluru-metro').click();
  // The confirmation names the consequence — new bookings refused AND live
  // offers revoked — not merely "are you sure".
  await expect(page.getByTestId('confirm-pause-zone-bengaluru-metro')).toBeVisible();
  await expect(page.getByTestId('zone-state-bengaluru-metro')).toContainText(
    'New bookings will be refused here and live offers revoked',
  );

  await page.getByTestId('confirm-pause-zone-bengaluru-metro').click();
  await expect(page.getByTestId('pause-zone-bengaluru-metro')).toContainText('Reopen zone');
});

test('the SEV banner previews what the apps will show, and validates the message', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/dispatch');

  await page.getByTestId('sev-level').selectOption('sev1');
  await expect(page.getByTestId('sev-preview')).toContainText('SEV1');
  // A level with no message is not publishable — the schema and a DB CHECK
  // agree, and the page says so before either is reached.
  await expect(page.getByTestId('sev-publish')).toBeDisabled();

  await page.getByTestId('sev-message').fill('Dispatch and booking creation are down');
  await expect(page.getByTestId('sev-preview')).toContainText(
    'Dispatch and booking creation are down',
  );
  await expect(page.getByTestId('sev-publish')).toBeEnabled();

  // Clearing is a different shape (both null) and is only offered when a banner
  // is actually live.
  await expect(page.getByTestId('sev-clear')).toBeDisabled();
});

test('the version gate refuses a non-semver', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/dispatch');

  await page.getByTestId('min-customer-version').fill('latest');
  await expect(page.getByTestId('appgate-save')).toBeDisabled();

  await page.getByTestId('min-customer-version').fill('1.4.2');
  await expect(page.getByTestId('appgate-save')).toBeEnabled();
});
