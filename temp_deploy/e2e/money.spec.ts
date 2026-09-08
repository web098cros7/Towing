import { expect, test } from '@playwright/test';
import { login } from './support/login';

/**
 * Phase-7 surfaces, mocks-on: earnings + payout request, settings, reports and
 * the print statement. Hermetic via `NEXT_PUBLIC_USE_MOCKS` — no backend, no
 * Razorpay.
 */

test.describe('earnings', () => {
  test('renders KPIs, the split table and payout history', async ({ page }) => {
    await login(page);
    await page.goto('/earnings');

    // The heading is asserted by smoke.spec.ts too — it must not drift.
    await expect(page.getByRole('heading', { name: 'Earnings & Payouts' })).toBeVisible();

    await expect(page.getByText('Wallet balance')).toBeVisible();
    await expect(page.getByText('Platform commission').first()).toBeVisible();
    await expect(page.getByText('Split breakdown per job')).toBeVisible();

    // `requested`/`paid`/`failed` — §5.5's vocabulary, not the old `pending`.
    await expect(page.getByText('Payout history')).toBeVisible();
    await expect(page.getByText('failed').first()).toBeVisible();

    // The effective share is computed from the totals, not read off a field.
    await expect(page.getByText(/effective fleet share this period is \d/)).toBeVisible();
  });

  test('request payout opens a dialog and validates against the minimum', async ({ page }) => {
    await login(page);
    await page.goto('/earnings');

    const request = page.getByRole('button', { name: 'Request payout' });
    // No longer the disabled Phase-2 stub.
    await expect(request).toBeEnabled();
    await request.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Request payout' })).toBeVisible();

    // Below `minPayoutPaise` — rejected before any request is made.
    await dialog.getByLabel('Amount (₹)').fill('5');
    await dialog.getByRole('button', { name: 'Request payout' }).click();
    await expect(dialog.getByText(/minimum payout is/i)).toBeVisible();

    // Above the available balance.
    await dialog.getByLabel('Amount (₹)').fill('99999999');
    await dialog.getByRole('button', { name: 'Request payout' }).click();
    await expect(dialog.getByText(/available/i).first()).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('a valid payout request closes the dialog', async ({ page }) => {
    await login(page);
    await page.goto('/earnings');

    await page.getByRole('button', { name: 'Request payout' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount (₹)').fill('5000');
    await dialog.getByRole('button', { name: 'Request payout' }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });
});

test.describe('settings', () => {
  test('renders the three cards and persists a preference toggle', async ({ page }) => {
    await login(page);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Business profile')).toBeVisible();
    await expect(page.getByText('Payout bank account')).toBeVisible();
    // `.first()` — the sidebar nav also contains the word.
    await expect(page.getByText('Notifications').first()).toBeVisible();

    // The bank account is redacted to the last four digits, always.
    await expect(page.getByText('•••• 4021')).toBeVisible();

    const jobsToggle = page.getByRole('switch', { name: 'New job notifications' });
    await expect(jobsToggle).toHaveAttribute('aria-checked', 'false');
    await jobsToggle.click();
    await expect(jobsToggle).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  });

  test('the business profile saves and reports it', async ({ page }) => {
    await login(page);
    await page.goto('/settings');

    await page.getByLabel('Registered address').fill('9 Residency Road, Bengaluru 560025');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  });

  test('an invalid GSTIN is rejected client-side by the shared schema', async ({ page }) => {
    await login(page);
    await page.goto('/settings');

    await page.getByLabel('GSTIN (optional)').fill('NOT-A-GSTIN');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Enter a valid 15-character GSTIN')).toBeVisible();
  });

  test('a complete account shows no onboarding banner', async ({ page }) => {
    // The settings mock defaults to `onboarding.step: 'done'` precisely so the
    // rest of the suite is not walking past a setup prompt.
    await login(page);
    await page.goto('/settings');

    await expect(page.getByRole('link', { name: 'Continue setup' })).toBeHidden();
  });
});

test.describe('reports', () => {
  test('generates a per-driver report for a preset period', async ({ page }) => {
    await login(page);
    await page.goto('/reports');

    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByText('No report generated')).toBeVisible();

    await page.getByRole('button', { name: 'Per driver' }).click();
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await page.getByRole('button', { name: 'Generate report' }).click();

    await expect(page.getByText('Anita Rao')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Driver share' })).toBeVisible();
  });

  test('the truck grain labels utilization as a period metric', async ({ page }) => {
    await login(page);
    await page.goto('/reports');

    await page.getByRole('button', { name: 'Per truck' }).click();
    await page.getByRole('button', { name: 'Generate report' }).click();

    // Same word as the dashboard KPI, different scope — the header says which.
    await expect(page.getByRole('columnheader', { name: 'Utilization (days)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Compliance' })).toBeVisible();
  });

  test('Custom reveals two date inputs', async ({ page }) => {
    await login(page);
    await page.goto('/reports');

    // By id, not by label: the topbar's "Toggle dark mode" button also matches
    // an accessible name of "To".
    await expect(page.locator('#report-from')).toBeHidden();
    await page.getByRole('button', { name: 'Custom' }).click();
    await expect(page.locator('#report-from')).toBeVisible();
    await expect(page.locator('#report-to')).toBeVisible();
  });

  test('Per period exposes a granularity control', async ({ page }) => {
    await login(page);
    await page.goto('/reports');

    await expect(page.getByRole('button', { name: 'month' })).toBeHidden();
    await page.getByRole('button', { name: 'Per period' }).click();
    await page.getByRole('button', { name: 'month' }).click();
    await page.getByRole('button', { name: 'Generate report' }).click();

    await expect(page.getByRole('columnheader', { name: 'Period' })).toBeVisible();
  });
});

test('the print statement renders without the console shell', async ({ page }) => {
  await login(page);

  const month = new Date().toISOString().slice(0, 7);
  await page.goto(`/statement/${month}`);

  await expect(page.getByRole('heading', { name: /Recovery Services/ })).toBeVisible();
  await expect(page.getByText('Earnings statement')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Fleet share' })).toBeVisible();

  // Its own route group: no sidebar, no topbar.
  await expect(page.getByRole('link', { name: 'Live map' })).toBeHidden();

  // §9.3.8 AC: no customer PII on an export.
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toContain('customer');
  expect(body).not.toContain('pickup');
});
