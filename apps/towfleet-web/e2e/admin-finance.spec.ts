import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * §9.4.10's Finance approval queue, hermetic (mocks-on).
 *
 * RENDERS AND CLIENT-SIDE VALIDATION ONLY, following the rule
 * `admin-kyc.spec.ts` states in its own header: "a mock mutation here would
 * only prove the mock data source resolves". Approving a payout is the most
 * consequential button in the console and its round trip belongs in
 * `e2e-live/`, against a real ledger — where "the balance came back to the
 * paisa" is a fact rather than a fixture.
 */

test('the Finance queue lists both owner types', async ({ page }) => {
  await adminLogin(page);

  // W1 §3.2 moved section navigation from the topbar into the permission-
  // filtered sidebar, so this no longer clicks a topbar link. It stays a DIRECT
  // goto rather than a sidebar click on purpose: the mock identity is
  // `operations`, which holds `finance.summary` but not `finance.read`, so the
  // sidebar correctly HIDES Finance for it — the filtering itself is asserted
  // in `admin-shell.spec.ts`.
  await page.goto('/admin/finance');

  await expect(page.getByRole('heading', { name: 'Payout approvals' })).toBeVisible();

  // §14.4 brought FLEET payouts under the same threshold in Phase 19; a queue
  // showing only drivers would hide that.
  await expect(page.getByText('Ramesh Kumar')).toBeVisible();
  await expect(page.getByText('Bengaluru Towing Co.')).toBeVisible();
});

test('the default filter is the pending queue, and "all" widens it', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');

  // Somebody opening this page came to work the queue, not to browse history.
  await expect(page.getByText('Anil Prasad')).toHaveCount(0);

  await page.getByTestId('finance-filter-all').click();
  await expect(page.getByText('Anil Prasad')).toBeVisible();
  await expect(page.getByText('Suresh Nair')).toBeVisible();
});

test('a pending payout opens a decision drawer showing both status axes', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');

  await page.getByText('Ramesh Kumar').click();

  await expect(page.getByTestId('finance-decide-approve')).toBeVisible();
  await expect(page.getByTestId('finance-decide-reject')).toBeVisible();

  // §5.5's VENDOR status and §14.4's APPROVAL state are separate axes and are
  // shown separately: a payout awaiting approval is `requested` because nobody
  // has told the vendor about it, and collapsing the two is how an operator
  // concludes the provider is slow.
  await expect(page.getByText('requested', { exact: true })).toBeVisible();
  await expect(page.getByText('pending approval')).toBeVisible();

  // The redacted destination — all the platform actually holds. Matched on the
  // digits rather than the bullets: the drawer and the table render the mask
  // differently (a template literal vs adjacent JSX expressions), and asserting
  // on the glyphs would be asserting on that difference.
  await expect(page.getByRole('dialog').getByText(/4021/)).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/HDFC Bank/)).toBeVisible();

  // The sentence that stops an operator reasoning wrongly about a rejection.
  await expect(page.getByText(/wallet was already debited/i)).toBeVisible();

  // W21: the notes panel drops into every detail screen. The driver-fixtured
  // notes must NOT appear for a payout subject — the empty state also proves
  // the panel scopes by subject, not just by screen.
  await expect(page.getByRole('heading', { name: 'Internal notes' })).toBeVisible();
  await expect(page.getByTestId('notes-empty')).toBeVisible();
});

test('rejection requires a reason before the confirm button enables', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');
  await page.getByText('Ramesh Kumar').click();

  await page.getByTestId('finance-decide-reject').click();

  const confirm = page.getByTestId('finance-confirm-reject');
  await expect(confirm).toBeDisabled();

  // Below the contract's five-character minimum.
  await page.getByTestId('finance-reject-reason').fill('no');
  await expect(confirm).toBeDisabled();

  await page.getByTestId('finance-reject-reason').fill('Bank details do not match the KYC name');
  await expect(confirm).toBeEnabled();
});

test('an already-decided payout offers no decision buttons', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');
  await page.getByTestId('finance-filter-all').click();

  await page.getByText('Suresh Nair').click();

  // `decideApproval` would 409 anyway — a guarded UPDATE whose zero-row result
  // means somebody already decided — but offering the button and then failing
  // is a worse answer than not offering it.
  await expect(page.getByTestId('finance-decide-approve')).toHaveCount(0);
  await expect(page.getByText('Bank details do not match the KYC name')).toBeVisible();
});

test('an unauthenticated visitor cannot reach the Finance queue', async ({ page }) => {
  await page.goto('/admin/finance');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('A20: the queue paginates — more than 50 payouts are reachable', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/finance');

  // 53 pending in the mock: the first page holds the canonical rows.
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await expect(page.getByText('Ramesh Kumar')).toBeVisible();

  await page.getByRole('button', { name: 'Next page' }).click();

  // The tail of the queue, unreachable before pagination.
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(page.getByText('Load Test Driver 51')).toBeVisible();
  await expect(page.getByText('Ramesh Kumar')).toHaveCount(0);

  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await expect(page.getByText('Ramesh Kumar')).toBeVisible();

  // Switching filters restarts from the top.
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await page.getByTestId('finance-filter-all').click();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
});
