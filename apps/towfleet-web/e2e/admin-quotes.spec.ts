import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W20's manual-quote queue, hermetic (mocks-on).
 *
 * The default mock identity is `operations`, which holds `quote.manage` — this
 * queue is exactly what an ops admin is for. The conversion the screen exists
 * to get right (rupees in, paise to the API) is asserted on the preview line,
 * because a misplaced zero here is a wrong price on a ₹85,000 tow.
 */

test('the queue lists requests with their distance and state', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/quotes');

  await expect(page.getByRole('heading', { name: 'Quotes' })).toBeVisible();
  await expect(page.getByTestId('quote-row')).toHaveCount(3);
  await expect(page.getByText('842 km')).toBeVisible();
  await expect(page.getByTestId('quote-status').first()).toContainText('Requested');
});

test('the operator prices a request in rupees and sees the customer’s figure', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/quotes');

  await page
    .getByTestId('quote-row')
    .filter({ hasText: 'Ravi Kumar' })
    .getByTestId('quote-open')
    .click();

  // The request carries no price yet — there is no offer panel — and the form
  // cannot send a partial one.
  await expect(page.getByTestId('drawer-quoted')).toHaveCount(0);
  await expect(page.getByTestId('quote-submit')).toBeDisabled();

  await page.getByTestId('price-rupees').fill('85000');
  // The preview is the conversion asserted: ₹85,000 typed → ₹85,000 shown.
  await expect(page.getByTestId('price-preview')).toContainText('₹85,000');
  await page.getByTestId('price-note').fill('Includes return leg');
  await page.getByTestId('quote-submit').click();
  await expect(page.getByText('Quote sent to the customer.')).toBeVisible();

  // The drawer now shows the offer with its validity window.
  await expect(page.getByTestId('drawer-quoted')).toContainText('₹85,000');
  await expect(page.getByTestId('drawer-valid-until')).toBeVisible();
});

test('a quote can be re-priced before it is answered, and rejected with a reason', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/quotes');

  await page
    .getByTestId('quote-row')
    .filter({ hasText: 'Meera Iyer' })
    .getByTestId('quote-open')
    .click();

  // The live offer is visible ABOVE the form — nobody re-prices blind.
  await expect(page.getByTestId('drawer-quoted')).toContainText('₹74,500');
  await expect(page.getByTestId('quote-submit')).toContainText('Re-quote');

  // A rejection needs its reason before the button unlocks.
  await expect(page.getByTestId('reject-submit')).toBeDisabled();
  await page.getByTestId('reject-reason').fill('no flatbed available in Goa this week');
  await page.getByTestId('reject-submit').click();
  await expect(page.getByText('Request rejected.')).toBeVisible();
  await expect(page.getByTestId('drawer-rejection')).toContainText('no flatbed available');
});

test('an accepted quote shows the booking it became', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/quotes');

  await page
    .getByTestId('quote-row')
    .filter({ hasText: 'Customer' })
    .getByTestId('quote-open')
    .click();

  await expect(page.getByTestId('drawer-booking')).toContainText('Booked as');
});
