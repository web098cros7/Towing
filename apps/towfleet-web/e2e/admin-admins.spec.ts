import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W2's admin directory — rendering only, mocks-on.
 *
 * The house rule (`admin-kyc.spec.ts`'s header, `adminFinanceDataSource.ts`):
 * a mocks-on spec asserts what renders and what client-side validation blocks,
 * never a mutation. Every mock mutation in `adminAdminsDataSource` is a
 * deliberate no-op that throws, so there is nothing to prove here beyond the
 * table, the filters and the create dialog's shape — the real writes are
 * exercised against a live backend.
 *
 * NOTE: mock login is `operations`, and mock mode does not enforce
 * `admin.manage`, so this renders the directory as an operator would see it if
 * they reached it. The super-admin-only refusal is a server-side rule proven
 * by the backend role-matrix spec, not something a hermetic mock can show.
 */
test('the admin directory renders the seeded admins', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/admins');

  await expect(page.getByRole('heading', { name: 'Admins' })).toBeVisible();
  await expect(page.getByText('Ananya Iyer')).toBeVisible();
  await expect(page.getByText('Rohit Menon')).toBeVisible();
  await expect(page.getByTestId('admins-filter-super_admin')).toBeVisible();
});

test('the role filter narrows the table', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/admins');

  await expect(page.getByText('Rohit Menon')).toBeVisible();

  await page.getByTestId('admins-filter-support').click();

  await expect(page.getByText('Fatima Sheikh')).toBeVisible();
  await expect(page.getByText('Rohit Menon')).toHaveCount(0);
});

test('the create dialog collects a new admin and asks for a sub-role', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/admins');

  await page.getByRole('button', { name: 'Create admin' }).click();

  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Sub-role')).toBeVisible();
  // `exact` matters: "Create" also substring-matches the page's own
  // "Create admin" button, and Playwright strict mode refuses an ambiguous one.
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
});
