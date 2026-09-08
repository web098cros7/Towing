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

test('the Finance queue is reachable from the topbar and lists both owner types', async ({
  page,
}) => {
  await adminLogin(page);

  // The topbar had NO navigation until Phase 19 — this link is the whole
  // reason a second admin page is usable at all.
  await page.getByRole('link', { name: 'Payouts' }).click();
  await expect(page).toHaveURL(/\/admin\/finance/);

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
