import { expect, test } from '@playwright/test';
import { liveLogin } from './support/live-login';

/**
 * THE ACCEPTANCE TEST FOR THE REFRESH GRACE WINDOW — the second half of the
 * Phase 8 deploy gate, proven through a real browser rather than a supertest
 * harness.
 *
 * The scenario is the ordinary one, which is what makes it worth automating: a
 * console with several panels open, an access token that has just expired, and
 * every in-flight query refreshing with the same refresh token at the same
 * moment — landing on whichever Next process the proxy picks.
 *
 * Before Phase 8 the backend treated the second use of a refresh token as
 * theft: one request won, the rest revoked the family, and the user was thrown
 * back to the login screen for doing nothing wrong. The BFF's in-flight map hid
 * that while there was one Next process. This test only means anything with
 * two, which is why it lives in the rehearsal suite.
 */
test('parallel requests on an expired access token keep the session alive', async ({
  page,
  context,
}) => {
  await liveLogin(page);

  // Force the expiry rather than waiting 15 minutes for it. Corrupting the
  // access-token cookie makes the backend reject it exactly as an expired one
  // would, so every parallel request 401s and every one of them refreshes.
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === 'fleet_session');
  expect(session, 'expected a fleet_session cookie after login').toBeTruthy();

  await context.addCookies([{ ...session!, value: `${session!.value}-corrupted` }]);

  // Six at once, through a proxy that round-robins across two Next processes.
  const paths = [
    '/api/proxy/dashboard',
    '/api/proxy/trucks?page=1&limit=5',
    '/api/proxy/drivers?page=1&limit=5',
    '/api/proxy/jobs?limit=5',
    '/api/proxy/alerts?limit=5',
    '/api/proxy/settings',
  ];

  const statuses = await page.evaluate(async (urls) => {
    const responses = await Promise.all(
      urls.map((url) => fetch(url, { credentials: 'include' }).then((res) => res.status)),
    );
    return responses;
  }, paths);

  // Every one of them must succeed. A single 401 here is the force-logout bug.
  expect(statuses, `expected six 200s, got ${statuses.join(', ')}`).toEqual([
    200, 200, 200, 200, 200, 200,
  ]);

  // And the session must still be usable afterwards — the family was rotated,
  // not revoked.
  await page.goto('/trucks');
  await expect(page).toHaveURL('/trucks');
  await expect(page.getByRole('heading', { name: 'Trucks' })).toBeVisible();
});
