import { expect, test, type BrowserContext } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W19's privacy console, hermetic (mocks-on).
 *
 * The default mock identity is `operations`, which does NOT hold
 * `privacy.handle` (the §4.2 matrix gives it to super_admin and support), so
 * the suite sets the `mock_sub_role` cookie the session route honours when
 * mocks are on — which is also how the first test proves the gate is real.
 */

const SUB_ROLE_COOKIE = 'mock_sub_role';

async function actAs(context: BrowserContext, subRole: 'support' | 'super_admin'): Promise<void> {
  await context.addCookies([
    { name: SUB_ROLE_COOKIE, value: subRole, url: 'http://localhost:3000' },
  ]);
}

test('operations cannot see the privacy queue at all', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/privacy');

  await expect(page.getByText(/does not include this queue/)).toBeVisible();
  await expect(page.getByTestId('request-row')).toHaveCount(0);
});

test('the queue shows the hold reason and the erasure log', async ({ page, context }) => {
  await adminLogin(page);
  await actAs(context, 'support');
  await page.goto('/admin/privacy');

  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(page.getByTestId('request-row')).toHaveCount(3);

  // The parked row says WHY it is parked, in the list.
  await expect(page.getByTestId('request-hold-reason').first()).toHaveText('open_payout:1');

  // The completed row's drawer renders the six-step log, including the refusal
  // that never happened for it — this one completed, so its steps are 'done'.
  await page
    .getByTestId('request-row')
    .filter({ hasText: 'Anonymised' })
    .first()
    .getByTestId('request-open')
    .click();
  await expect(page.getByTestId('drawer-job')).toBeVisible();
  await expect(page.getByTestId('step-row')).toHaveCount(6);
  await expect(page.getByText('erase_booking_pii')).toBeVisible();

  // The open row's drawer instead shows the refusal that DID happen.
  await page.getByRole('button', { name: 'Close' }).click();
  await page
    .getByTestId('request-row')
    .filter({ hasText: 'Ganesh Patil' })
    .getByTestId('request-open')
    .click();
  await expect(page.getByTestId('drawer-hold-reason')).toContainText('open_payout:1');
  await expect(page.getByTestId('step-row')).toHaveCount(1);
  await expect(page.getByText('refused')).toBeVisible();
});

test('the workflow: approve, then execute behind a typed confirmation', async ({
  page,
  context,
}) => {
  await adminLogin(page);
  await actAs(context, 'support');
  await page.goto('/admin/privacy');

  await page
    .getByTestId('request-row')
    .filter({ hasText: 'Ravi Kumar' })
    .getByTestId('request-open')
    .click();

  // Executing before approval is refused ON SCREEN, with the reason.
  await expect(page.getByTestId('execute')).toBeDisabled();
  await expect(page.getByTestId('execute-guard')).toContainText('Approve the request first');

  await page.getByTestId('approve').click();
  await expect(page.getByText('Request approved.')).toBeVisible();

  // Approval does not loosen the typed gate: the button stays disabled until
  // the word is typed, and then it works.
  await expect(page.getByTestId('execute')).toBeDisabled();
  await page.getByTestId('execute-confirm').fill('DELETE');
  await expect(page.getByTestId('execute')).toBeEnabled();
  await page.getByTestId('execute').click();
  await expect(page.getByText('Erasure queued.')).toBeVisible();
});

test('retention is readable by the lane, editable only by a super admin', async ({
  page,
  context,
}) => {
  await adminLogin(page);
  await actAs(context, 'support');
  await page.goto('/admin/privacy');
  await page.getByTestId('tab-retention').click();

  await expect(page.getByTestId('policy-row')).toHaveCount(6);
  // The two kinds of policy are visibly different: three are swept, three are
  // declarative floors (KYC, audit, wave logs).
  await expect(page.getByTestId('policy-enforced')).toHaveCount(3);
  await expect(page.getByTestId('policy-policy-only')).toHaveCount(3);

  await expect(page.getByTestId('policy-days-location_paths')).toBeDisabled();
  await expect(page.getByTestId('retention-guard')).toContainText('Super admin only');

  // The same page as a super admin: editable, and the save reports back.
  await actAs(context, 'super_admin');
  await page.reload();
  await page.getByTestId('tab-retention').click();
  await expect(page.getByTestId('policy-days-location_paths')).toBeEnabled();
  await page.getByTestId('policy-days-location_paths').fill('90');
  await page.getByTestId('retention-save').click();
  await expect(page.getByText(/Retention updated/)).toBeVisible();
});

test('the customer detail serves the export and the correction', async ({ page, context }) => {
  // W19 put DPDP's access and correction rights on the customer's own detail.
  await adminLogin(page);
  await actAs(context, 'support');
  await page.goto('/admin/users/00000000-0000-4000-8000-000000000001');

  const download = page.waitForEvent('download');
  await page.getByTestId('admin-user-export').click();
  await download;
  await expect(page.getByText(/Export generated/)).toBeVisible();

  await page.getByTestId('admin-user-correct').click();
  await page.getByTestId('correct-name').fill('Ravi Kumaar');
  // A correction without a reason is not submittable — it is the audited why.
  await expect(page.getByTestId('correct-submit')).toBeDisabled();
  await page.getByTestId('correct-reason').fill('customer called, typo in their name');
  await page.getByTestId('correct-submit').click();
  await expect(page.getByText(/Details corrected/)).toBeVisible();
});
