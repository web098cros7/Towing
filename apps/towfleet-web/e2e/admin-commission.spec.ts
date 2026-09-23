import { expect, test } from '@playwright/test';
import { serviceTypeSchema } from '@towing/api-contracts';
import { adminLogin } from './support/adminLogin';

/**
 * W11's commission screen, hermetic (mocks-on).
 *
 * THE MOCK IDENTITY IS `operations`, which is the interesting case: they hold
 * `commission.propose` and NOT `commission.edit`, so this file pins the split
 * §4.2 asks for — bands are read-only for them, the propose form is theirs, and
 * the guardrail editor (decision G2, super admin only) is not on the page at
 * all.
 *
 * RENDERS AND CLIENT-SIDE VALIDATION ONLY, per the house rule: the round trip
 * (a save that writes config + history + audit, and a proposal that applies
 * through the guardrail) belongs to `admin-config.e2e.spec.ts`.
 */

test('operations see the bands read-only, the propose form, and no guardrail editor', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/commission');

  await expect(page.getByRole('heading', { name: 'Commission' })).toBeVisible();
  await expect(page.getByTestId('band-A')).toHaveValue('10');
  await expect(page.getByTestId('band-B')).toHaveValue('8');
  await expect(page.getByTestId('band-C')).toHaveValue('5');

  // The window is rendered from the live guardrail, not from a constant.
  await expect(page.getByTestId('band-window')).toContainText('5–10 %');

  // No save button, and the page says who can.
  await expect(page.getByTestId('band-save')).toHaveCount(0);
  await expect(page.getByTestId('band-readonly')).toBeVisible();

  // `commission.guardrail` is super admin only — absent, not disabled.
  await expect(page.getByTestId('guardrail-floor')).toHaveCount(0);

  // The propose form is theirs.
  await expect(page.getByTestId('proposal-submit')).toBeVisible();
});

test('the propose form refuses a percentage outside the live window', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/commission');

  await page.getByTestId('proposal-pct').fill('11');
  await page.getByTestId('proposal-reason').fill('Trying it on');
  await expect(page.getByTestId('proposal-window-error')).toBeVisible();
  await expect(page.getByTestId('proposal-submit')).toBeDisabled();

  // A value inside the window arms it.
  await page.getByTestId('proposal-pct').fill('9');
  await expect(page.getByTestId('proposal-window-error')).toHaveCount(0);
  await expect(page.getByTestId('proposal-submit')).toBeEnabled();
});

test('the open proposal is listed with its status and reason', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/commission');

  await expect(page.getByTestId('proposal-row')).toHaveCount(1);
  await expect(page.getByTestId('proposal-status-open')).toBeVisible();
  await expect(page.getByText('Band B → 7.5%')).toBeVisible();
  await expect(page.getByText('Driver supply is strong this month')).toBeVisible();
});

test("the impact preview is the operator's own draft, over a chosen window", async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/commission');

  // Type a draft: 10 % → 9 %. Nothing is saved by typing.
  await page.getByTestId('band-A').fill('9');
  await page.getByTestId('impact-preview').click();

  await expect(page.getByTestId('impact-table')).toBeVisible();
  // The mock recomputes from the same numbers the table shows: a 10 % → 9 % cut
  // on ₹4,200 of Band A commission is −₹420.
  await expect(page.getByTestId('impact-total-delta')).toContainText('₹420.00');

  // 30 days is a different window, and the panel re-asks.
  await page.getByTestId('impact-days').selectOption('30');
  await expect(page.getByTestId('impact-table')).toBeVisible();
});

test('the band-to-service map is derived from the shared band rule', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/commission');

  const mapping = page.getByTestId('band-mapping');
  await expect(mapping).toBeVisible();
  // One row per service type. Counted off the shared enum, not a literal: this
  // said 6 and went stale twice (Lockout, then Winch Out) without the screen
  // being wrong either time.
  await expect(mapping.locator('tbody tr')).toHaveCount(serviceTypeSchema.options.length);
  // §3.3: accident recovery is never Band A, whatever the distance.
  const accidentRow = mapping.locator('tbody tr', { hasText: 'accident recovery' });
  await expect(accidentRow).toContainText('B');
  // …and a long tow is Band C for every service.
  await expect(mapping.locator('tbody tr').first()).toContainText('C');
});

test('the change history reads the version trail back', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/commission');

  await expect(page.getByTestId('commission-history-row')).toHaveCount(2);
  await expect(page.getByText('Festive season retention')).toBeVisible();
  // Genesis rows show 'launch' rather than an empty before-column.
  await expect(page.getByText('launch → 5%')).toBeVisible();
});
