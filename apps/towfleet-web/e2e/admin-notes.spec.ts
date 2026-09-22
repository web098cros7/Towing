import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W21's notes panel, hermetic (mocks-on) — render and client-side validation
 * only: the mock's write path is a deliberate no-op, and the audited
 * create/update/delete round trip lives in the backend's
 * `admin-notes.e2e.spec.ts` and `e2e-live/`.
 *
 * The panel is mounted in the KYC drawer, which is the proof of the design's
 * whole claim: ONE component that drops into every detail screen — the fixture
 * is keyed to the same mock driver the review spec opens.
 */
test('the notes panel drops into the KYC drawer with the subject’s notes', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/drivers');

  await page.getByText('Prakash Naik').click();
  await expect(page.getByRole('heading', { name: 'Internal notes' })).toBeVisible();

  await expect(page.getByTestId('notes-count')).toHaveText('2');
  await expect(
    page.getByText('Called the driver — the RC photo is of the older vehicle.'),
  ).toBeVisible();

  // The fixture's authors are OTHER admins, so the mock identity sees the read
  // view only — no delete affordance on someone else's note.
  await expect(page.getByTestId('note-delete-d0000001-0001-4000-8000-000000000001')).toHaveCount(0);

  // Add-note form: the button refuses an empty body (the API's own minimum).
  const submit = page.getByTestId('note-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('note-body').fill('Checked the RC against the vehicle.');
  await expect(submit).toBeEnabled();
});
