import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W6 — the users directory, mocks-on (§9.4.4).
 *
 * Renders the operator's flow end to end: search and filter, the suspension
 * requests inbox, the suspend dialog's reason gate, and the read-only app-view
 * session with its five sections. The backend rules behind each (trigram
 * search, 403-plus-request for support, audited reads) are proved against the
 * real server in `admin-directory-users.e2e.spec.ts` and
 * `admin-impersonation.e2e.spec.ts` — this file proves the console.
 */
test.describe('admin users directory', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('searches, suspends, and files/approves requests', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    // All three fixture customers render.
    await expect(page.getByText('Meera Iyer')).toBeVisible();
    await expect(page.getByText('Ravi Kumar')).toBeVisible();
    await expect(page.getByText('Asha Rao')).toBeVisible();

    // Search narrows to the suspended customer; clearing brings the rest back.
    const search = page.getByTestId('admin-users-search');
    await search.fill('ravi');
    await expect(page.getByText('Meera Iyer')).toHaveCount(0);
    await expect(page.getByText('Ravi Kumar')).toBeVisible();
    await search.fill('');
    await expect(page.getByText('Meera Iyer')).toBeVisible();

    // The suspension dialog gates on a real reason (min 4 characters).
    await page.getByTestId('admin-user-suspend').first().click();
    const submit = page.getByTestId('suspend-dialog-submit');
    await expect(submit).toBeDisabled();
    await page.getByTestId('suspend-dialog-reason').fill('Chargeback abuse');
    await expect(submit).toBeEnabled();
    await submit.click();
    // The native <dialog> stays in the DOM once closed — assert HIDDEN, not gone.
    await expect(submit).toBeHidden();

    // The requests tab lists support's filed requests with their subjects.
    await page.getByRole('tab', { name: 'Suspension requests' }).click();
    await expect(page.getByText('Three chargebacks this month')).toBeVisible();
    await expect(page.getByText('Repeated no-shows after accepting')).toBeVisible();
    await page.getByTestId('admin-request-approve').first().click();
    await expect(page.getByTestId('admin-request-error')).toHaveCount(0);
  });

  test('opens a customer and runs a read-only app-view session', async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByTestId('admin-user-open').first().click();
    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+$/);
    await expect(page.getByTestId('admin-user-detail')).toBeVisible();
    await expect(page.getByText('12 bookings lifetime')).toBeVisible();

    // Trips tab shows the customer's history.
    await page.getByRole('tab', { name: 'Trips' }).click();
    await expect(page.getByText('paid')).toBeVisible();

    // Impersonation: a reason is required, then the red-banner app view opens.
    await page.getByTestId('admin-user-impersonate').click();
    await page.getByTestId('impersonate-dialog-reason').fill('Investigating a support ticket');
    await page.getByTestId('impersonate-dialog-submit').click();
    await expect(page).toHaveURL(/\/app-view\?session=[0-9a-f-]+$/);
    await expect(page.getByTestId('app-view-banner')).toBeVisible();
    await expect(page.getByText('Read-only impersonation')).toBeVisible();

    // All five sections render from the customer contracts.
    await expect(page.getByTestId('app-view-trips')).toContainText('TW-');
    await expect(page.getByTestId('app-view-wallet')).toContainText('₹250');
    await expect(page.getByTestId('app-view-notifications')).toContainText('Trip completed');
    await expect(page.getByTestId('app-view-vehicles')).toContainText('Toyota Fortuner');
    await expect(page.getByTestId('app-view-addresses')).toContainText('MG Road');

    // Ending the session reports back and returns to the customer.
    await page.getByTestId('app-view-end').click();
    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+$/);
  });
});
