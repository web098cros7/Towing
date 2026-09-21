import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_REFRESH_COOKIE,
  clearAdminSessionCookies,
  setAdminSessionCookies,
} from '@/lib/adminSession';
import { callUpstreamWithRefresh } from '@/lib/refreshingUpstream';

/** Admin logout. Revokes the refresh family backend-side, then always clears cookies. */
export async function DELETE() {
  if (!env.useMocks) {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get(ADMIN_REFRESH_COOKIE)?.value;
    if (refreshToken) {
      await fetch(`${env.apiBaseUrl}/v1/admin/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      }).catch(() => {});
    }
  }

  const response = NextResponse.json({ ok: true });
  clearAdminSessionCookies(response);
  return response;
}

/**
 * Session identity for the admin console shell (A7).
 *
 * The browser never holds a token — the access JWT lives in the httpOnly
 * `admin_session` cookie — so any screen asking "what may this admin do"
 * reads it here instead of a second login. Returns `{ admin }` (the backend
 * `adminIdentitySchema` payload); fine-grained permissions arrive with W1's
 * permission model, until then screens branch on `admin.subRole`.
 */
export async function GET() {
  if (env.useMocks) {
    /**
     * The mock identity is `operations` by default — the sub-role most screens
     * are written against. A hermetic spec that needs a DIFFERENT sub-role
     * (W19's privacy queue is super_admin/support only, and no ops admin may
     * see it) sets the `mock_sub_role` cookie before loading the console; in
     * production the branch below reads the real session instead, so this
     * seam cannot exist outside mocks-on.
     */
    const cookieStore = await cookies();
    const requested = cookieStore.get('mock_sub_role')?.value;
    const subRole =
      (['super_admin', 'operations', 'support', 'finance'] as const).find(
        (role) => role === requested,
      ) ?? 'operations';

    return NextResponse.json({
      admin: {
        // Fixed UUID — see the note on the mock in `verify/route.ts`.
        id: '00000000-0000-4000-8000-000000000001',
        email: 'ops@towing.local',
        name: 'Mock Admin',
        subRole,
        twofaEnabled: false,
      },
    });
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const refreshToken = cookieStore.get(ADMIN_REFRESH_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Not signed in' } },
      { status: 401 },
    );
  }

  // M0-F1: through the proxy's single refresh path, not a bare fetch. An
  // expired access token is silently rotated and retried; cookies are cleared
  // only when the REFRESH fails (a dead session), never on a merely expired
  // access token. A second, independent refresh here would race the proxy's
  // and trip family-reuse revocation.
  let upstream: Response;
  let rotated: { accessToken: string; refreshToken: string } | null;
  try {
    const result = await callUpstreamWithRefresh(
      {
        upstreamPrefix: 'admin',
        setSessionCookies: setAdminSessionCookies,
        clearSessionCookies: clearAdminSessionCookies,
      },
      {
        path: 'auth/me',
        method: 'GET',
        headers: new Headers({ Accept: 'application/json' }),
        accessToken,
        refreshToken,
      },
    );
    if (result.kind === 'expired') {
      const response = NextResponse.json(
        { error: { code: 'unauthorized', message: 'Session expired — sign in again' } },
        { status: 401 },
      );
      clearAdminSessionCookies(response);
      return response;
    }
    if (result.kind === 'no-session') {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'Not signed in' } },
        { status: 401 },
      );
    }
    ({ upstream, rotated } = result);
  } catch {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Sign-in service unavailable' } },
      { status: 502 },
    );
  }

  // Success and non-401 errors (e.g. 403 for a deactivated admin) pass
  // through with their status, so the provider can tell "signed out" apart
  // from "signed in but not allowed".
  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const response = NextResponse.json(
      body ?? { error: { code: 'internal_error', message: 'Request failed' } },
      { status: upstream.status },
    );
    if (rotated) setAdminSessionCookies(response, rotated);
    return response;
  }
  const response = NextResponse.json({ admin: body });
  if (rotated) setAdminSessionCookies(response, rotated);
  return response;
}
