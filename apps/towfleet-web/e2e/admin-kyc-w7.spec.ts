import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W7 — the finished KYC console, mocks-on: the paged queue, bulk approve/reject
 * with per-item results, the zoomable viewer, per-document upload history, the
 * decision-history feed and the Suspend/Reactivate pair.
 *
 * House rule (see `admin-kyc.spec.ts`): mocks-on specs assert RENDERS and
 * wiring, never backend behaviour. The one deliberate bend is the
 * `mock-partial-failure` sentinel, which exists so the per-item RESULTS panel —
 * the whole point of a bulk action — is reachable without a backend.
 */

test('bulk approve needs the typed word and reports every driver’s outcome', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');

  await expect(page.getByTestId('kyc-queue-total')).toContainText('12 drivers');
  await page.getByTestId('select-row-admin-mock-driver-1').check();
  await page.getByTestId('select-row-admin-mock-driver-2').check();
  await expect(page.getByTestId('kyc-bulk-bar')).toContainText('2 selected');

  await page.getByTestId('kyc-bulk-approve').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Approve 2 drivers')).toBeVisible();

  // The typed gate: the button stays disabled until the word matches.
  const submit = page.getByTestId('bulk-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('bulk-confirm-word').fill('approv');
  await expect(submit).toBeDisabled();
  await page.getByTestId('bulk-confirm-word').fill('APPROVE');
  await expect(submit).toBeEnabled();
  await submit.click();

  // Per-item results, not a single toast.
  await expect(page.getByTestId('bulk-results')).toBeVisible();
  await expect(page.getByTestId('bulk-summary')).toContainText('2 of 2 decided');
  await expect(page.getByTestId('bulk-result-admin-mock-driver-1')).toContainText('approved');
  await expect(page.getByTestId('bulk-result-admin-mock-driver-2')).toContainText('approved');

  await page.getByTestId('bulk-close').click();

  // The decided drivers leave the queue the list came from (the mock is
  // stateful, exactly like the real one).
  await expect(page.getByTestId('kyc-queue-total')).toContainText('10 drivers');
  await expect(page.getByText('Prakash Naik')).toHaveCount(0);
});

test('bulk reject requires a shared reason, and a partial failure is visible per driver', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');

  await page.getByTestId('select-row-admin-mock-driver-3').check();
  await page.getByTestId('select-row-admin-mock-driver-4').check();
  await page.getByTestId('kyc-bulk-reject').click();

  // A reject can never be submitted without a reason shared by every driver.
  await page.getByTestId('bulk-confirm-word').fill('REJECT');
  await expect(page.getByTestId('bulk-submit')).toBeDisabled();

  await page.getByTestId('bulk-reason').fill('mock-partial-failure');
  await expect(page.getByTestId('bulk-submit')).toBeEnabled();
  await page.getByTestId('bulk-submit').click();

  await expect(page.getByTestId('bulk-summary')).toContainText('1 of 2 decided');
  await expect(page.getByTestId('bulk-summary')).toContainText('1 failed');
  await expect(page.getByTestId('bulk-result-admin-mock-driver-3')).toContainText('partial failure');
  await expect(page.getByTestId('bulk-result-admin-mock-driver-4')).toContainText('rejected');
});

test('the queue pages, and select-all only takes the page in front of you', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');

  await expect(page.getByText('Tara Krishnan')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Tara Krishnan')).toBeVisible();
  await expect(page.getByText('Prakash Naik')).toHaveCount(0);

  await page.getByTestId('select-all-rows').check();
  await expect(page.getByTestId('kyc-bulk-bar')).toContainText('2 selected');
});

test('the drawer shows the last known location, upload history, decision history and a zoomable viewer', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');
  await page.getByText('Prakash Naik').click();

  // "GPS on map" is labelled for what it is: the last known position, with the
  // ping it came from — never presented as a live one.
  const location = page.getByTestId('kyc-location');
  await expect(location).toContainText('Last known location');
  await expect(location).toContainText('last ping');

  // W7's history: the licence was resubmitted, so the replaced file is listed.
  const history = page.getByTestId('kyc-versions').first();
  await expect(history).toContainText('Upload history (2)');
  await history.locator('summary').click();
  await expect(history).toContainText('replaced');

  // Decision history comes from the subject-scoped audit feed.
  await expect(page.getByTestId('kyc-history')).toContainText('driver.kyc.request_info');

  // The zoomable viewer: CSS transform, no library.
  await page.getByTestId('kyc-zoom-doc-1a').click();
  const viewer = page.getByTestId('document-viewer-image');
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId('document-viewer-zoom')).toHaveText('100%');
  await page.getByTestId('document-viewer-zoom-in').click();
  await expect(page.getByTestId('document-viewer-zoom')).toHaveText('150%');
  await page.getByTestId('document-viewer-close').click();
  await expect(viewer).toBeHidden();
});

test('suspend records a reason (with the A14 mode) and offers the immediate undo', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');
  await page.getByText('Meena Iyer').click();

  // A driver who never pinged says so instead of drawing an empty map.
  await expect(page.getByTestId('kyc-location-none')).toBeVisible();

  await page.getByTestId('kyc-decide-suspend').click();
  await expect(page.getByTestId('kyc-suspend-mode')).toBeVisible();
  const confirm = page.getByTestId('kyc-confirm-decision');
  await expect(confirm).toBeDisabled();
  await page.locator('#overall-reason').fill('Documents do not match the vehicle');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByTestId('kyc-suspended-note')).toBeVisible();
  await page.getByTestId('kyc-decide-reactivate').click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
