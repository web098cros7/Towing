import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W15's support console, hermetic (mocks-on).
 *
 * The mock's mutations are live, so the flow this file walks — reply in
 * public, note in private, assign, move status — is the real one, and the
 * PUBLIC/INTERNAL split is asserted where it matters most: the console's
 * thread shows both and labels the internal one loudly. (The requester's half
 * of the split is `SupportService`'s SQL filter, proven by
 * `support.e2e.spec.ts`.)
 *
 * Order matters: the mock keeps state per server process, so the queue is
 * asserted before anything mutates it.
 */

const OPEN_TICKET = '51000000-0000-4000-8000-000000000001';
const PENDING_TICKET = '51000000-0000-4000-8000-000000000002';
const RESOLVED_TICKET = '51000000-0000-4000-8000-000000000003';

test('the queue defaults to open tickets and colours the SLA', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/support');

  await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible();
  // EXACT: the SOS banner in the shell names Meera too (the two mock fixtures
  // share the name).
  await expect(page.getByText('Meera Nair', { exact: true })).toBeVisible();
  await expect(page.getByText('Kiran B')).toBeVisible();
  await expect(page.getByText('Lakshmi Logistics')).toHaveCount(0);

  // Five hours old on a high-priority ticket: overdue, and said so.
  await expect(page.getByTestId('support-overdue').first()).toContainText(/overdue/i);

  await page.getByTestId('tab-s:resolved').click();
  await expect(page.getByText('Lakshmi Logistics')).toBeVisible();
  // Exact again: the row leaves this tab, the shell banner keeps its own copy.
  await expect(page.getByText('Meera Nair', { exact: true })).toHaveCount(0);
});

test('the thread shows the conversation, internal notes included', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/support/${PENDING_TICKET}`);

  await expect(page.getByRole('heading', { name: 'Payout short by ₹120' })).toBeVisible();
  await expect(page.getByText('My payout is ₹120 short this week.')).toBeVisible();

  // The console is the one place both halves are visible — and the internal
  // one carries the label, so nobody mistakes it for something the driver saw.
  const internal = page.getByTestId('support-internal-note');
  await expect(internal).toContainText('Internal: split run shows a cancelled job.');
  await expect(internal).toContainText('requester never sees this');
});

test('assign to me claims an unassigned ticket', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/support/${OPEN_TICKET}`);

  const assign = page.getByTestId('support-assign');
  await expect(assign).toBeEnabled();
  await assign.click();
  await expect(page.getByTestId('toast-success')).toContainText('assigned to you');
  await expect(assign).toBeDisabled();
  await expect(assign).toContainText('Assigned to you');
});

test('a reply lands in the thread and clears the composer', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/support/${PENDING_TICKET}`);

  const body = page.getByTestId('support-composer-body');
  const send = page.getByTestId('support-send');
  await expect(send).toBeDisabled();

  await body.fill('Settlement run re-issued — the ₹120 lands by tonight.');
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByTestId('toast-success')).toContainText('Reply sent');
  await expect(
    page.getByText('Settlement run re-issued — the ₹120 lands by tonight.'),
  ).toBeVisible();
  await expect(body).toHaveValue('');

  // A public reply is not an internal note.
  await expect(page.getByTestId('support-internal-note')).toHaveCount(1);
});

test('an internal note is saved and labelled as internal', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/support/${PENDING_TICKET}`);

  await page.getByTestId('support-composer-body').fill('Internal: check the split table again.');
  await page.getByTestId('support-note').click();

  await expect(page.getByTestId('toast-success')).toContainText('Internal note saved');
  await expect(page.getByTestId('support-internal-note').last()).toContainText(
    'Internal: check the split table again.',
  );
});

test('status moves only along the legal graph, and a resolved ticket can reopen', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto(`/admin/support/${RESOLVED_TICKET}`);

  // From resolved: Closed and In progress are legal; the earlier states are not.
  await expect(page.getByTestId('support-status-closed')).toBeEnabled();
  await expect(page.getByTestId('support-status-in_progress')).toBeEnabled();
  await expect(page.getByTestId('support-status-open')).toBeDisabled();
  await expect(page.getByTestId('support-status-pending_requester')).toBeDisabled();

  await page.getByTestId('support-status-in_progress').click();
  await expect(page.getByTestId('toast-success')).toContainText('Moved to In progress');
  await expect(page.getByText('In progress').first()).toBeVisible();
  // Reopening drops the resolution stamp, so the SLA cell starts reading the
  // first response again instead of "finished".
  await expect(page.getByText('This ticket is finished.')).toHaveCount(0);
});

test('an unauthenticated visitor cannot reach the support console', async ({ page }) => {
  await page.goto('/admin/support');
  await expect(page).toHaveURL(/\/admin\/login/);
});
