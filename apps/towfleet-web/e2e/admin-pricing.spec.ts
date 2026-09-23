import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W10's pricing editor, hermetic (mocks-on).
 *
 * RENDERS AND CLIENT-SIDE VALIDATION ONLY — the house rule. The mock data
 * source applies config edits so the operator preview behaves, but nothing here
 * asserts a mutation: the real round trip (a save that prices the very next
 * estimate) is `admin-config.e2e.spec.ts`'s and `e2e-live/`'s job.
 *
 * The mock identity is `operations`, which W10's G1 explicitly allows here —
 * §4.2's matrix gives Operations the pricing and surge levers.
 */

test('renders both slab matrices from the launch rate card, with their charges', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/pricing');

  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();

  // §7.1/§7.2: two tables, per vehicle class (decision G9 — no multiplier).
  await expect(page.getByTestId('matrix-wheel_lift')).toBeVisible();
  await expect(page.getByTestId('matrix-flatbed')).toBeVisible();
  await expect(page.getByTestId('pricing-price-wheel_lift-5')).toHaveValue('999');
  await expect(page.getByTestId('pricing-price-flatbed-5')).toHaveValue('1999');
  await expect(page.getByTestId('pricing-price-wheel_lift-100')).toHaveValue('7999');

  // §7.3 ranges carry a floor AND a ceiling…
  await expect(page.getByTestId('pricing-price-long-150')).toHaveValue('16000');
  await expect(page.getByTestId('pricing-ceiling-long-150')).toHaveValue('20000');
  // …and the roadside call-outs are flat fares.
  await expect(page.getByTestId('pricing-price-roadside-battery')).toHaveValue('799');

  // §7.4 charges and the surge percentages behind the bands.
  await expect(page.getByTestId('charges-night-pct')).toHaveValue('15');
  await expect(page.getByTestId('charges-night-start')).toHaveValue('22');
  await expect(page.getByTestId('charges-night-end')).toHaveValue('6');
  await expect(page.getByTestId('surge-high-pct')).toHaveValue('10');
  await expect(page.getByTestId('surge-peak-pct')).toHaveValue('25');
});

test('the worked example recomputes from the numbers on screen', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/pricing');

  // Defaults: 8 km wheel-lift, 14:00, standard surge → the 0–10 km slab.
  await expect(page.getByTestId('example-total')).toHaveText('₹1,499.00');
  await expect(page.getByTestId('example-band')).toHaveText('A');

  // A shorter tow lands in the 0–5 km slab.
  await page.getByTestId('example-distance').fill('3');
  await expect(page.getByTestId('example-total')).toHaveText('₹999.00');

  // 23:00 IST is inside the 22→6 night window: +15 % of the base.
  await page.getByTestId('example-hour').fill('23');
  await expect(page.getByTestId('example-total')).toHaveText('₹1,148.85');

  // Peak surge is +25 % of everything before it.
  await page.getByTestId('example-surge').selectOption('peak');
  await expect(page.getByTestId('example-total')).toHaveText('₹1,436.06');

  // Band C is the §7.3 long-distance territory, and it interpolates.
  await page.getByTestId('example-surge').selectOption('standard');
  await page.getByTestId('example-hour').fill('14');
  await page.getByTestId('example-distance').fill('120');
  await expect(page.getByTestId('example-band')).toHaveText('C');
  // 120 km is 40 % across the 100–150 band: 16000 + 0.4 × 4000 = ₹17,600.
  await expect(page.getByTestId('example-total')).toHaveText('₹17,600.00');

  // Over the §7.3 ceiling the engine has no price to give — say so.
  await page.getByTestId('example-distance').fill('700');
  await expect(page.getByTestId('example-error')).toContainText('manual quote');
});

test('saving is a DIFF: enabled only when something changed and the numbers are valid', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/pricing');

  // Untouched: nothing to save.
  await expect(page.getByTestId('pricing-save-rules')).toBeDisabled();

  // A changed fare arms the save.
  await page.getByTestId('pricing-price-wheel_lift-5').fill('1099');
  await expect(page.getByTestId('pricing-save-rules')).toBeEnabled();

  // Garbage disarms it, with the reason on screen.
  await page.getByTestId('pricing-price-wheel_lift-5').fill('');
  await expect(page.getByTestId('pricing-rules-error')).toBeVisible();
  await expect(page.getByTestId('pricing-save-rules')).toBeDisabled();

  // A range ceiling below its floor is refused client-side (the schema and the
  // DB CHECK are the backstops, not the first line).
  await page.getByTestId('pricing-price-wheel_lift-5').fill('999');
  await page.getByTestId('pricing-ceiling-long-150').fill('15000');
  await expect(page.getByTestId('pricing-rules-error')).toBeVisible();
  await expect(page.getByTestId('pricing-save-rules')).toBeDisabled();
});

test('adding a band refuses one that is already priced, and says why', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/pricing');

  await page.getByTestId('pricing-new-wheel_lift-km').fill('20');
  await page.getByTestId('pricing-new-wheel_lift-price').fill('2500');
  await page.getByTestId('pricing-add-wheel_lift').click();

  // Duplicate ACTIVE band — the 409 the API would answer, caught here first.
  await expect(page.getByTestId('pricing-error')).toContainText('retire that band');
});

test('retiring a band asks first, then removes it from the active table', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/pricing');

  await page.getByTestId('pricing-deactivate-wheel_lift-5').click();
  await expect(page.getByTestId('pricing-confirm-retire-wheel_lift-5')).toBeVisible();
  await page.getByTestId('pricing-confirm-retire-wheel_lift-5').click();

  await expect(page.getByTestId('pricing-price-wheel_lift-5')).toHaveCount(0);
  await expect(page.getByTestId('matrix-wheel_lift')).toContainText('Retired');
});

test('the night window refuses two of the same hour before saving', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/pricing');

  await page.getByTestId('charges-night-end').fill('22');
  await expect(page.getByTestId('charges-window-error')).toBeVisible();
  await expect(page.getByTestId('charges-save')).toBeDisabled();

  await page.getByTestId('charges-night-end').fill('6');
  await expect(page.getByTestId('charges-window-error')).toHaveCount(0);
});

test('the history drawer reads the version trail back', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/pricing');

  await page.getByTestId('pricing-history-open').click();

  await expect(page.getByRole('heading', { name: 'Fare history' })).toBeVisible();
  await expect(page.getByTestId('pricing-history-row')).toHaveCount(3);
  await expect(page.getByTestId('pricing-history-list')).toContainText('Fuel cost review');
  await expect(page.getByTestId('pricing-history-list')).toContainText('Band added');
  await expect(page.getByTestId('pricing-history-list')).toContainText('Band retired');
});

test('an unpriced roadside service says it is not offered, and needs a fare to launch', async ({
  page,
}) => {
  // Winch Out ships with no fare. The row has to say so: an empty cell would
  // read as a fare of zero or a failed load, and launching it is a separate,
  // deliberate click rather than part of "Save fares" (the backend round trip
  // is `pricing.e2e.spec.ts`).
  await adminLogin(page);
  await page.goto('/admin/pricing');

  const row = page.getByTestId('pricing-unpriced-winch_out');
  await expect(row).toBeVisible();
  await expect(row.getByText('Not offered — no fare set')).toBeVisible();
  // The five priced services keep their ordinary editable fare.
  await expect(page.getByTestId('pricing-unpriced-battery')).toHaveCount(0);

  await page.getByTestId('pricing-offer-winch_out').click();
  await expect(page.getByTestId('pricing-error')).toHaveText(
    'Enter a fare above zero before offering Winch out.',
  );
});
