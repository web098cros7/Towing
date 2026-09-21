import { expect, test } from '@playwright/test';
import { adminLogin } from './support/adminLogin';

/**
 * W13's service-zone editor, hermetic (mocks-on).
 *
 * RENDERS AND CLIENT-SIDE VALIDATION ONLY, per the house rule. What this screen
 * exists to make safe is exactly what a mock cannot prove — a saved polygon
 * really repricing the next estimate, a reshape really re-homing the drivers
 * standing in the difference, a paused zone really refusing go-online — and all
 * three are asserted against the real database in
 * `admin-zones.e2e.spec.ts` (backend). Here: the rail, the form's validators,
 * the pause confirmation and the history drawer's wiring.
 *
 * The mock identity is `operations`, who hold `zone.edit`.
 */

test('renders the service areas, the overlap rule and the map toolbar', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/zones');

  await expect(page.getByRole('heading', { name: 'Zones' })).toBeVisible();

  // The launch set, with the state each zone is actually in.
  await expect(page.getByTestId('zone-row-bengaluru-metro')).toContainText('Bengaluru Metro');
  await expect(page.getByTestId('zone-state-bengaluru-metro')).toContainText('Live');
  await expect(page.getByTestId('zone-row-nh-44-bengaluru-hosur')).toContainText(
    'NH-44 Bengaluru–Hosur Corridor',
  );
  await expect(page.getByTestId('zone-state-nh-44-bengaluru-hosur')).toContainText('Paused');
  await expect(page.getByTestId('zone-row-nh-44-bengaluru-hosur')).toContainText('highway');

  // The resolution order is stated where the overlap is visible, not in a doc.
  await expect(page.getByText('Highway zones win an overlap.')).toBeVisible();

  // The map or its labelled fallback: WebGL is a browser capability, and this
  // spec is about the panels either way (`admin-live-map.spec.ts`'s rule —
  // canvas OR the honest panel, never a blank box).
  const surface = page.locator('[data-testid="zone-map"], [data-testid="zone-map-fallback"]');
  await expect(surface).toBeVisible();

  // Nothing is selected, so the shape tools that act on a selection are off.
  await expect(page.getByTestId('zone-draw')).toBeVisible();
  await expect(page.getByTestId('zone-edit-shape')).toBeDisabled();
  await expect(page.getByTestId('zone-clear')).toBeDisabled();

  // When the canvas is real, the toolbar is wired to the LIVE draw instance:
  // Clear only enables if Terra Draw started, since the mode it reports comes
  // from the library rather than from a local flag. Drawing four corners is a
  // client-side interaction with no request behind it — the shape reaching the
  // database is `admin-zones.e2e.spec.ts`'s job, not this file's.
  if ((await page.getByTestId('zone-map').count()) === 0) {
    // Named rather than silent: a skipped block that never says so is how a
    // suite stops testing anything.
    test.info().annotations.push({
      type: 'webgl',
      description: 'unavailable — the draw toolbar was not exercised',
    });
  } else {
    await page.getByTestId('zone-draw').click();
    await expect(page.getByTestId('zone-clear')).toBeEnabled();

    const map = await page.getByTestId('zone-map').boundingBox();
    for (const [fx, fy] of [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.7, 0.7],
      [0.3, 0.7],
    ] as const) {
      await page.mouse.click(map!.x + map!.width * fx, map!.y + map!.height * fy);
      await page.waitForTimeout(150);
    }
    await expect(page.getByTestId('zone-shape-hint')).toContainText('Shape captured');

    // …and clearing it puts the form back to "nothing drawn yet".
    await page.getByTestId('zone-clear').click();
    await expect(page.getByTestId('zone-clear')).toBeDisabled();
    await expect(page.getByTestId('zone-shape-hint')).toContainText('No shape yet');
  }
});

test('a new zone needs a code the audit trail can cite, and a shape', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/zones');
  await page.getByTestId('zone-new').click();

  await expect(page.getByText('New service area')).toBeVisible();
  // No shape yet — the panel says where the shape comes from.
  await expect(page.getByTestId('zone-shape-hint')).toContainText('Draw polygon');
  await expect(page.getByTestId('zone-save')).toBeDisabled();

  await page.getByTestId('zone-name').fill('Mumbai Metro');
  await page.getByTestId('zone-code').fill('Mumbai Metro!');
  await expect(page.getByTestId('zone-code-error')).toContainText('lower-case words');
  await expect(page.getByTestId('zone-save')).toBeDisabled();

  // A valid slug clears the complaint but does not make the form savable: the
  // polygon is still missing.
  await page.getByTestId('zone-code').fill('mumbai-metro');
  await expect(page.getByTestId('zone-code-error')).toHaveCount(0);
  await expect(page.getByTestId('zone-save')).toBeDisabled();
  await expect(page.getByTestId('zone-shape-hint')).toContainText('No shape yet');
});

test('selecting a zone loads it, and every write requires a reason', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/zones');

  await page.getByTestId('zone-row-bengaluru-metro').click();
  await expect(page.getByTestId('zone-name')).toHaveValue('Bengaluru Metro');
  await expect(page.getByTestId('zone-code')).toHaveValue('bengaluru-metro');
  // The shape on the map is the saved one, so there is nothing to save yet.
  await expect(page.getByTestId('zone-shape-hint')).toContainText('matches the saved one');
  await expect(page.getByTestId('zone-save')).toBeDisabled();

  await page.getByTestId('zone-name').fill('Bengaluru Metro (north)');
  await expect(page.getByTestId('zone-save')).toBeDisabled();

  // Too short to be a reason is a complaint; three characters is enough to be
  // one — the drawer shows this text beside the shape months later.
  await page.getByTestId('zone-reason').fill('x');
  await expect(page.getByTestId('zone-reason-error')).toBeVisible();
  await expect(page.getByTestId('zone-save')).toBeDisabled();

  await page.getByTestId('zone-reason').fill('Split the northern half out');
  await expect(page.getByTestId('zone-reason-error')).toHaveCount(0);
  await expect(page.getByTestId('zone-save')).toBeEnabled();
});

test('pausing a zone asks first, and says what pausing does to the drivers inside', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto('/admin/zones');
  await page.getByTestId('zone-row-bengaluru-metro').click();

  await page.getByTestId('zone-toggle-bengaluru-metro').click();
  await expect(page.getByTestId('zone-active-state')).toContainText(
    'drivers inside re-homed or taken offline',
  );

  // Backing out leaves the zone live — the confirmation is not a formality.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('zone-active-state')).toContainText('Priced and dispatchable');
  await expect(page.getByTestId('zone-state-bengaluru-metro')).toContainText('Live');
});

test('the history drawer lists every shape and marks the one in force', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/zones');
  await page.getByTestId('zone-row-bengaluru-metro').click();

  await page.getByTestId('zone-versions').click();
  await expect(
    page.getByRole('heading', { name: /Bengaluru Metro — shape history/ }),
  ).toBeVisible();

  await expect(page.getByTestId('version-row-3')).toContainText('Split the southern edge');
  await expect(page.getByTestId('version-current')).toContainText('the shape in force');
  // The migrated row: nobody reshaped it, the seed wrote it.
  await expect(page.getByTestId('version-row-1')).toContainText('Seeded before the zone editor');
  await expect(page.getByTestId('version-restore-1')).toBeVisible();
});

test('the impact preview names what a shape covers before it is saved', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/zones');
  await page.getByTestId('zone-row-bengaluru-metro').click();

  await page.getByTestId('zone-preview').click();
  // A dry run: nothing is written, and the panel is the only thing that changes.
  await expect(page.getByTestId('zone-impact')).toContainText('km²');
  await expect(page.getByTestId('zone-impact-overlaps')).toContainText(
    'NH-44 Bengaluru–Hosur Corridor',
  );
  await expect(page.getByTestId('zone-save')).toBeDisabled();
});
