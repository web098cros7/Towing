import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W9's finance console, hermetic (mocks-on).
 *
 * RENDERS AND CLIENT-SIDE VALIDATION ONLY — the house rule: a mock mutation
 * would only prove the mock resolves, and this screen's one write (issuing a
 * refund) moves money. Its round trip belongs in `e2e-live/`, against a real
 * ledger.
 *
 * The existing `admin-finance.spec.ts` keeps pinning the PAYOUTS tab that W8
 * and the earlier milestones shipped; this file covers what W9 added around it.
 */

test('the console opens on Payouts, with the SLA and the invariants below the queue', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/finance');

  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payout approvals' })).toBeVisible();

  // §14.4's decision latency, with the queue-depth number called out.
  await expect(page.getByTestId('payout-sla')).toBeVisible();
  await expect(page.getByText('Waiting > 24 h now')).toBeVisible();

  // §14.1's five invariants, all zero — and the panel says so in words.
  await expect(page.getByTestId('invariants-status')).toHaveText('All zero');
  await expect(page.getByTestId('invariants-list').locator('li')).toHaveCount(5);
});

test('the transactions tab lists every payment fate, refunds included', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');
  await page.getByTestId('tab-transactions').click();

  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await expect(page.getByText('TW-4D5E6F70')).toBeVisible();
  // The partially-refunded capture shows the running total, not just the face
  // value — the W8 arithmetic made visible.
  await expect(page.getByText('−₹500 refunded')).toBeVisible();
  // And a FAILED attempt is on the same list; hiding those is how an operator
  // tells a customer their money never left.
  await expect(page.getByText('TW-3C4D5E6F')).toBeVisible();

  await page.getByTestId('transactions-status').selectOption('failed');
  await expect(page.getByText('TW-3C4D5E6F')).toBeVisible();
  await expect(page.getByText('TW-4D5E6F70')).toHaveCount(0);
});

test('the ledger viewer shows SIGNED legs and filters by type', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');
  await page.getByTestId('tab-ledger').click();

  await expect(page.getByRole('heading', { name: 'Wallet ledger' })).toBeVisible();
  // A credit and its clawback, both visible with their signs (the debits carry
  // Intl's own minus sign — the ledger's convention, not a styled helper's).
  await expect(page.getByText('+₹1,350')).toBeVisible();
  await expect(page.getByText('-₹500')).toBeVisible();

  await page.getByTestId('ledger-type').selectOption('refund_debit');
  await expect(page.getByText('-₹500')).toBeVisible();
  await expect(page.getByText('+₹1,350')).toHaveCount(0);

  // Five rows fit one page of fifty: both cursors have nothing to do.
  await expect(page.getByTestId('ledger-older')).toBeDisabled();
  await expect(page.getByTestId('ledger-newer')).toBeDisabled();
});

test('the refunds list distinguishes full reversals from partials', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');
  await page.getByTestId('tab-refunds').click();

  await expect(page.getByRole('heading', { name: 'Refunds' })).toBeVisible();
  await expect(page.getByText('TW-708192A3')).toBeVisible();

  await page.getByTestId('refunds-kind').selectOption('full');
  await expect(page.getByText('TW-5E6F7081')).toBeVisible();
  await expect(page.getByText('TW-708192A3')).toHaveCount(0);
});

test('the refund drawer demands a real booking, an amount shape and a reason', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');
  await page.getByTestId('tab-refunds').click();

  await page.getByTestId('refund-issue-open').click();
  const submit = page.getByTestId('refund-submit');
  await expect(submit).toBeDisabled();

  // A half-typed uuid is refused before the API ever sees it.
  await page.getByTestId('refund-booking').fill('44444444-4444');
  await page.getByTestId('refund-reason').fill('Customer asked for a refund');
  await expect(submit).toBeDisabled();

  await page.getByTestId('refund-booking').fill('44444444-4444-4444-8444-444444444444');
  await expect(submit).toBeEnabled();

  // Typing an amount turns this into a PARTIAL, and a partial must say WHY
  // (ADM-6) — the cause and where the money goes appear with it.
  await expect(page.getByTestId('refund-cause')).toHaveCount(0);
  await page.getByTestId('refund-amount').fill('500');
  await expect(page.getByTestId('refund-cause')).toBeVisible();
  await expect(page.getByTestId('refund-delivery')).toBeVisible();
  await expect(submit).toBeEnabled();
});

test('the policy tab validates the cancel windows before Save enables', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');
  await page.getByTestId('tab-config').click();

  await expect(page.getByRole('heading', { name: 'Finance policy' })).toBeVisible();
  await expect(page.getByTestId('config-payout-max')).toHaveValue('100000');
  await expect(page.getByTestId('config-cancel-free')).toHaveValue('2');

  // The partial window must not start before the free window ends — the schema
  // and the DB both refuse it, so the console must not offer it.
  await page.getByTestId('config-cancel-partial').fill('1');
  await expect(page.getByTestId('config-window-error')).toBeVisible();
  await expect(page.getByTestId('config-save')).toBeDisabled();

  await page.getByTestId('config-cancel-partial').fill('10');
  await page.getByTestId('config-cancel-fee').fill('200');
  await expect(page.getByTestId('config-save')).toBeEnabled();
});
