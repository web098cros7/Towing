import { expect, test } from '@playwright/test';

/**
 * Phase 18 — §11.7's public share-trip page.
 *
 * THE FIRST TEST HERE IS THE IMPORTANT ONE, and it is the reason this file
 * exists at all. `middleware.ts` is deny-by-default: every path that is not
 * `/login` redirects an unauthenticated visitor. The share page is the only
 * route in the app that must NOT do that, and the failure mode is invisible to
 * anybody developing it — you are logged in, so it works. A customer's spouse
 * following a link at nine at night is not, and would be asked for a fleet-owner
 * password.
 *
 * `page.goto` in a fresh Playwright context carries no cookies, which is exactly
 * the condition that breaks it.
 *
 * The API is stubbed at the route level rather than run against a backend: this
 * spec is about the page and the middleware, and `share-trip.e2e.spec.ts` and
 * `track-projection.spec.ts` already cover the server's half — including the
 * assertion that the projection carries no PII.
 */

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

const LIVE_TRIP = {
  status: 'en_route',
  driverFirstName: 'Anita',
  vehiclePlate: 'KA 05 MJ 8842',
  position: { lat: 12.988, lng: 77.612, headingDeg: 210, at: new Date().toISOString() },
  pickupArea: { lat: 12.972, lng: 77.595 },
  etaSeconds: 480,
  routePolyline: null,
  expiresAt: null,
  at: new Date().toISOString(),
};

test('a share link opens with no session at all', async ({ page }) => {
  await page.route(`**/api/track/${TOKEN}`, (route) =>
    route.fulfill({ status: 200, json: LIVE_TRIP }),
  );

  await page.goto(`/t/${TOKEN}`);

  // NOT redirected to /login. This is the assertion the middleware branch exists
  // for, and the one that would silently regress if the branch were removed.
  await expect(page).toHaveURL(`/t/${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Live tow' })).toBeVisible();
});

test('shows the driver first name, the plate and an ETA — and nothing more', async ({ page }) => {
  await page.route(`**/api/track/${TOKEN}`, (route) =>
    route.fulfill({ status: 200, json: LIVE_TRIP }),
  );

  await page.goto(`/t/${TOKEN}`);

  await expect(page.getByText('Anita')).toBeVisible();
  await expect(page.getByText('KA 05 MJ 8842')).toBeVisible();
  await expect(page.getByText('8 min')).toBeVisible();
  await expect(page.getByText('On the way')).toBeVisible();

  // Says out loud that the position is approximate. A viewer who walked to the
  // dot and found nobody would reasonably conclude the page was broken.
  await expect(page.getByText(/Positions are approximate/)).toBeVisible();
});

test('an expired link reads as ended, not as missing', async ({ page }) => {
  // Somebody was sent this because a person they care about was in trouble.
  // "No such trip" invites them to think they mistyped it.
  await page.route(`**/api/track/${TOKEN}`, (route) =>
    route.fulfill({
      status: 410,
      json: { error: { code: 'share_link_expired', message: 'This trip link has ended' } },
    }),
  );

  await page.goto(`/t/${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'This trip has ended' })).toBeVisible();
});

test('an unknown link says so plainly', async ({ page }) => {
  await page.route(`**/api/track/${TOKEN}`, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'Trip not found' } },
    }),
  );

  await page.goto(`/t/${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
});

test('keeps the last known trip through a failed poll rather than blanking', async ({ page }) => {
  let call = 0;
  await page.route(`**/api/track/${TOKEN}`, (route) => {
    call += 1;
    return call === 1
      ? route.fulfill({ status: 200, json: LIVE_TRIP })
      : route.fulfill({ status: 502, json: { error: { code: 'internal_error', message: 'x' } } });
  });

  await page.goto(`/t/${TOKEN}`);
  await expect(page.getByText('Anita')).toBeVisible();

  // A viewer watching a truck must not lose it to one bad poll.
  await page.waitForTimeout(11_000);
  await expect(page.getByText('Anita')).toBeVisible();
});

test('the console is still deny-by-default for everything else', async ({ page }) => {
  // The public branch is a PREFIX allowlist, and a regression that widened it
  // would be a much worse bug than the one the first test guards.
  await page.goto('/trucks');
  await expect(page).toHaveURL(/\/login/);
});
