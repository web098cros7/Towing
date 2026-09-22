import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W15's content editor, hermetic (mocks-on).
 *
 * The editor is an upsert: one form creates and edits, and publishing is the
 * save. These specs walk that — a draft becomes live, a live page becomes a
 * draft, and a brand-new slug appears in the list — because "the apps read
 * whatever is published" is the only promise this screen makes.
 *
 * The app-side read (Help and Legal fetching `/v1/content/*`) is proven in
 * `content.e2e.spec.ts` against the real backend and in the live look script.
 */

test('the FAQ tab lists the entries and opens the first one', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/content');

  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible();
  await expect(page.getByTestId('content-row')).toHaveCount(6);
  await expect(page.getByText('How do I book a tow truck?')).toBeVisible();

  // The first page is selected for the operator — never an empty form beside a
  // non-empty list.
  await expect(page.getByTestId('content-slug')).toHaveValue('faq-how-do-i-book');
  await expect(page.getByTestId('content-body')).toHaveValue(/pickup location/);

  await page.getByRole('tab', { name: 'Legal' }).click();
  await expect(page.getByTestId('content-row')).toHaveCount(2);
  await expect(page.getByText('Privacy Policy')).toBeVisible();
});

test('editing a page saves it and the list shows the new title', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/content');

  await page.getByTestId('content-title').fill('How do I book a tow truck? (updated)');
  await page.getByTestId('content-save').click();

  await expect(page.getByTestId('toast-success')).toContainText('is live');
  await expect(
    page.getByRole('button', { name: /How do I book a tow truck\? \(updated\)/ }),
  ).toBeVisible();

  // The slug is not editable once a page exists — apps deep-link to it.
  await expect(page.getByTestId('content-slug')).toBeDisabled();
});

test('unpublishing marks the page as a draft', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/content');

  await page.getByTestId('content-published').uncheck();
  await page.getByTestId('content-save').click();

  await expect(page.getByTestId('toast-success')).toContainText('saved as draft');
  await expect(page.getByTestId('content-row').first()).toContainText('Draft');
});

test('a new page is created from a slug and published on save', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/content');

  await page.getByTestId('content-new').click();
  await expect(page.getByTestId('content-slug')).toBeEnabled();
  await expect(page.getByTestId('content-save')).toBeDisabled();

  await page.getByTestId('content-slug').fill('faq-can-i-schedule-a-tow');
  await page.getByTestId('content-title').fill('Can I schedule a tow for tomorrow?');
  await page.getByTestId('content-body').fill('Yes — pick a later time slot when you book.');
  await page.getByTestId('content-save').click();

  await expect(page.getByTestId('toast-success')).toContainText('is live');
  await expect(page.getByTestId('content-row')).toHaveCount(7);
  // The ROW, not a bare text match: the success toast carries the same title.
  await expect(
    page.getByRole('button', { name: /Can I schedule a tow for tomorrow\?/ }),
  ).toBeVisible();
});

test('an unauthenticated visitor cannot reach the content editor', async ({ page }) => {
  await page.goto('/admin/content');
  await expect(page).toHaveURL(/\/admin\/login/);
});
