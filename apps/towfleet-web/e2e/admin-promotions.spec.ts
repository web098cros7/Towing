import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W16's promotions console, hermetic (mocks-on).
 *
 * The mock keeps state per server process and its mutations are LIVE, so this
 * file walks the real flows: filter the coupon table, edit one and watch the
 * customer-preview maths move with it, create one, reorder the carousel, flip
 * a banner's switch and create one through the presign→upload→save path.
 *
 * ORDER MATTERS — later tests observe earlier tests' mutations (SAVE20 ends up
 * at 30%, MEGA50 and “Winter ready” exist). Same discipline as the support
 * spec: assert reads before writes.
 */

test('lists coupons and filters them', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/promotions');

  await expect(page.getByRole('heading', { name: 'Promotions' })).toBeVisible();
  await expect(page.getByText('SAVE20')).toBeVisible();
  await expect(page.getByText('FLAT100')).toBeVisible();
  await expect(page.getByText('MONSOON15')).toBeVisible();

  await page.getByTestId('coupons-search').fill('FLAT');
  await expect(page.getByText('FLAT100')).toBeVisible();
  await expect(page.getByText('SAVE20')).toHaveCount(0);

  await page.getByTestId('coupons-search').fill('');
  await page.getByTestId('coupons-active-filter').selectOption('false');
  await expect(page.getByText('MONSOON15')).toBeVisible();
  await expect(page.getByText('SAVE20')).toHaveCount(0);
});

test('the coupon form refuses bad values on the field, before anything is sent', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/promotions');

  await page.getByTestId('coupon-new').click();
  await expect(page.getByRole('heading', { name: 'New coupon' })).toBeVisible();

  // Nothing typed yet: the code is too short.
  await page.getByTestId('coupon-save').click();
  await expect(page.getByTestId('coupon-error-code')).toHaveText(
    'A coupon code needs at least 3 characters',
  );

  await page.getByTestId('coupon-code').fill('OVER100');
  await page.getByTestId('coupon-percent').fill('150');
  await page.getByTestId('coupon-starts').fill('2026-10-10T20:00');
  await page.getByTestId('coupon-expires').fill('2026-10-01T09:00');
  await page.getByTestId('coupon-save').click();

  await expect(page.getByTestId('coupon-error-percent')).toHaveText(
    'A percentage cannot exceed 100',
  );
  await expect(page.getByTestId('coupon-error-expires')).toHaveText(
    'Expires must be after it starts',
  );
  await expect(page.getByTestId('coupon-error-code')).toHaveCount(0);

  // Refused on the spot: no success toast, and the drawer stays open.
  await expect(page.getByTestId('toast-success')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'New coupon' })).toBeVisible();

  // Fixing a field clears just its own message.
  await page.getByTestId('coupon-percent').fill('50');
  await expect(page.getByTestId('coupon-error-percent')).toHaveCount(0);
  await expect(page.getByTestId('coupon-error-expires')).toBeVisible();

  // Zero is refused too.
  await page.getByTestId('coupon-percent').fill('0');
  await page.getByTestId('coupon-save').click();
  await expect(page.getByTestId('coupon-error-percent')).toHaveText(
    'The percentage must be greater than 0',
  );
});

test('editing a coupon moves the customer preview and saves', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/promotions');

  await page.getByText('SAVE20').click();
  await expect(page.getByRole('heading', { name: 'Edit SAVE20' })).toBeVisible();

  // 20% of the ₹2,000 sample, under the ₹1,000 cap.
  await expect(page.getByTestId('coupon-preview-discount')).toContainText('₹400');

  await page.getByTestId('coupon-percent').fill('30');
  await expect(page.getByTestId('coupon-preview-discount')).toContainText('₹600');
  await expect(page.getByTestId('coupon-preview-total')).toContainText('₹1,400');

  await page.getByTestId('coupon-save').click();
  await expect(page.getByTestId('toast-success')).toContainText('SAVE20 saved');
  await expect(page.getByText(/30%/)).toBeVisible();
});

test('creates a new coupon', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/promotions');

  await page.getByTestId('coupon-new').click();
  await expect(page.getByRole('heading', { name: 'New coupon' })).toBeVisible();

  await page.getByTestId('coupon-code').fill('MEGA50');
  await page.getByTestId('coupon-percent').fill('50');
  await page.getByTestId('coupon-save').click();

  await expect(page.getByTestId('toast-success')).toContainText('MEGA50 saved');
  await expect(page.getByText('MEGA50')).toBeVisible();
});

test('reorders the carousel and flips a banner switch', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/promotions');
  await page.getByTestId('tab-banners').click();

  await expect(page.getByText('Customer carousel (MiTow app)')).toBeVisible();
  const rows = page.getByTestId('banner-row');
  await expect(rows.nth(0)).toContainText('Launch offer');
  await expect(rows.nth(1)).toContainText('Monsoon drive');

  await page.getByRole('button', { name: 'Move Launch offer down' }).click();
  await expect(rows.nth(0)).toContainText('Monsoon drive');
  await expect(rows.nth(1)).toContainText('Launch offer');

  // The off switch is independent of the schedule, and says so.
  const toggle = page.getByRole('switch', { name: 'Launch offer active' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('creates a banner through the upload path', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/promotions');
  await page.getByTestId('tab-banners').click();

  await page.getByTestId('banner-new').click();
  await expect(page.getByRole('heading', { name: 'New banner' })).toBeVisible();

  await page.getByTestId('banner-title').fill('Winter ready');
  await page.getByTestId('banner-image-input').setInputFiles({
    name: 'winter.png',
    mimeType: 'image/png',
    // A one-pixel PNG is enough: the mock simulates the upload and the
    // preview is the local blob.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.getByTestId('banner-image-preview')).toBeVisible();

  await page.getByTestId('banner-cta-label').fill('Book now');
  await page.getByTestId('banner-save').click();

  await expect(page.getByTestId('toast-success')).toContainText('Winter ready');
  await expect(page.getByText('Winter ready')).toBeVisible();
});
