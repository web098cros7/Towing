import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W5 — the dispatch inspector, mocks-on (rendering and client-side behaviour).
 *
 * The wave-log WRITE path — terms recomputing to the score, a failed insert not
 * failing the wave — is proven against the real engine in
 * `admin-ops-dispatch.e2e.spec.ts`, because only there does a wave actually run.
 * This file proves the operator's view: the list, the candidate bars, the
 * expandable exclusions and the offer log.
 */
test.describe('admin dispatch inspector', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('lists live searches and inspects a wave', async ({ page }) => {
    await page.goto('/admin/ops/dispatch');
    await expect(page.getByRole('heading', { name: 'Dispatch inspector' })).toBeVisible();

    const rows = page.getByTestId('admin-dispatch-search');
    await expect(rows).toHaveCount(2);
    // The unstarted search says so rather than faking a wave.
    await expect(rows.nth(1)).toContainText('Not started');

    await rows.first().getByRole('link', { name: 'Inspect' }).click();
    await expect(page).toHaveURL(/\/admin\/ops\/dispatch\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: /Dispatch inspector/ })).toBeVisible();

    // Two waves, six ranked candidates, four per-term bars each.
    const candidates = page.getByTestId('admin-dispatch-candidate');
    await expect(candidates).toHaveCount(6);

    const proximityBars = page.locator(
      '[data-testid="admin-dispatch-term"][data-term="proximity"]',
    );
    await expect(proximityBars).toHaveCount(6);

    // The wave's counters render beside its heading.
    await expect(page.getByText('Wave 1', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('4 in range').first()).toBeVisible();

    // Exclusion details name drivers, not just counts.
    const exclusions = page.getByTestId('admin-dispatch-exclusion');
    await expect(exclusions).toHaveCount(3);
    await exclusions.first().locator('summary').click();
    await expect(exclusions.first()).toContainText('00000000-0000-4000-8000-0000000000d7');

    // The offer log joins driver names to outcomes.
    await expect(page.getByTestId('admin-dispatch-attempt')).toHaveCount(4);
    await expect(page.getByText('Ravi Kumar')).toBeVisible();

    // The mini-map renders or degrades, the same either-way the live map asserts.
    await expect(
      page.locator('[data-testid="admin-map"], [data-testid="admin-map-unavailable"]').first(),
    ).toBeVisible();
  });
});
