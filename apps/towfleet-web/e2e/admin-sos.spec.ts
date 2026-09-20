import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W14's SOS console, hermetic (mocks-on).
 *
 * The mock keeps its mutations in module state on purpose: acknowledge →
 * resolve is this screen's whole flow, and the persistent banner clearing is
 * only testable if the flow actually moves. Everything asserted here is a
 * render or a client-side gate — the socket delivery, the 2-second budget and
 * the real workflow are proven against the backend (`sos-realtime.e2e.spec.ts`,
 * `sos.e2e.spec.ts`) and in `e2e-live/`.
 */

const OPEN_ALERT = '11111111-1111-4111-8111-111111111111';

test('the queue defaults to open alerts', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/sos');

  await expect(page.getByRole('heading', { name: 'SOS' })).toBeVisible();
  // EXACT: the shell's persistent banner ALSO names Meera Nair (W14 added it),
  // so a bare text match is two elements now.
  await expect(page.getByText('Meera Nair', { exact: true })).toBeVisible();
  // Both are closed — they belong to their own tabs, not the working queue.
  await expect(page.getByText('Arun Prasad')).toHaveCount(0);
  await expect(page.getByText('Kiran B')).toHaveCount(0);

  await page.getByTestId('tab-resolved').click();
  await expect(page.getByText('Arun Prasad')).toBeVisible();

  await page.getByTestId('tab-cancelled').click();
  await expect(page.getByText('Kiran B')).toBeVisible();
});

test('the persistent banner follows the open alert into every console page', async ({ page }) => {
  await adminLogin(page);

  // The dashboard is not an SOS page — the banner is a shell concern.
  await page.goto('/admin');
  const banner = page.getByTestId('admin-sos-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Meera Nair');

  await banner.click();
  await expect(page).toHaveURL(new RegExp(`/admin/sos/${OPEN_ALERT}$`));
});

test('acknowledging clears the unacknowledged banner and updates the timeline', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto(`/admin/sos/${OPEN_ALERT}`);

  await expect(page.getByTestId('sos-unacknowledged')).toBeVisible();
  await page.getByTestId('sos-acknowledge').click();
  await expect(page.getByTestId('toast-success')).toContainText('acknowledged');
  await expect(page.getByTestId('sos-unacknowledged')).toHaveCount(0);
  await expect(page.getByTestId('sos-timeline')).toContainText('Acknowledged');

  // The banner is data-driven, so the ack propagates to the shell too.
  await page.goto('/admin');
  await expect(page.getByTestId('admin-sos-banner')).toHaveCount(0);
});

test('the contact call says out loud when it is not masked', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/sos/${OPEN_ALERT}`);

  await page.getByTestId('sos-contact').click();
  const result = page.getByTestId('sos-contact-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('+919845010001');
  await expect(page.getByTestId('sos-contact-unmasked')).toBeVisible();

  // The snapshot's channel outcomes are rendered, not implied: SMS is blocked
  // on DLT and WhatsApp on template approval — the designed degradation.
  await expect(page.getByTestId('sos-contacts')).toContainText('blocked (dlt_template_missing)');
  await expect(page.getByTestId('sos-contacts')).toContainText('blocked (wa_template_missing)');
});

test('resolve insists on a note, and the typed broadcast gate holds', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/sos/${OPEN_ALERT}`);

  const resolve = page.getByTestId('sos-resolve');
  await expect(resolve).toBeDisabled();
  await page.getByTestId('sos-resolution').fill('Reached her; safe; closing.');
  await expect(resolve).toBeEnabled();

  const broadcast = page.getByTestId('sos-broadcast');
  await expect(broadcast).toBeDisabled();
  await page.getByTestId('sos-broadcast-confirm').fill('BROADCAST');
  await expect(broadcast).toBeEnabled();
});

test('an unauthenticated visitor cannot reach the SOS console', async ({ page }) => {
  await page.goto('/admin/sos');
  await expect(page).toHaveURL(/\/admin\/login/);
});
