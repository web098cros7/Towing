import { expect, test, type BrowserContext } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * Proves the access-denied panel never renders while permissions are still resolving,
 * and that a failed identity load reports the failure with a retry affordance
 * instead of falsely claiming the operator lacks access.
 */

async function actAsSuper(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { name: 'mock_sub_role', value: 'super_admin', url: 'http://localhost:3000' },
  ]);
}

test('a slow identity never flashes the access-denied card', async ({ page, context }) => {
  await adminLogin(page);
  await actAsSuper(context);

  // Record every moment the denial card exists in the DOM — a single check after the fact
  // cannot prove it never flashed.
  await page.addInitScript(() => {
    (window as unknown as { __forbiddenSeen: boolean }).__forbiddenSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="admin-forbidden"]')) {
        (window as unknown as { __forbiddenSeen: boolean }).__forbiddenSeen = true;
      }
    }).observe(document, { childList: true, subtree: true });
  });

  await page.route('**/api/admin-session', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.continue();
  });

  await page.goto('/admin/sos');
  await expect(page.getByTestId('admin-forbidden-pending')).toBeVisible();
  await expect(page.getByTestId('sos-subject-filter')).toBeVisible({ timeout: 10_000 });
  expect(
    await page.evaluate(() => (window as unknown as { __forbiddenSeen: boolean }).__forbiddenSeen),
  ).toBe(false);
  await expect(page.getByTestId('admin-forbidden')).toHaveCount(0);
});

test('a failed identity load offers a retry instead of denying access', async ({
  page,
  context,
}) => {
  await adminLogin(page);
  await actAsSuper(context);

  let failing = true;
  await page.route('**/api/admin-session', async (route) => {
    if (route.request().method() === 'GET' && failing) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.continue();
  });

  await page.goto('/admin/sos');
  await expect(page.getByTestId('admin-identity-error')).toContainText(
    "Couldn't load your permissions",
    { timeout: 10_000 },
  );
  await expect(page.getByTestId('admin-forbidden')).toHaveCount(0);

  failing = false;
  await page.getByTestId('admin-identity-error').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('sos-subject-filter')).toBeVisible({ timeout: 10_000 });
});
