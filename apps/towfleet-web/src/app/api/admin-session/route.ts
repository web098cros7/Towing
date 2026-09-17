import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_REFRESH_COOKIE,
  clearAdminSessionCookies,
} from '@/lib/adminSession';

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
    return NextResponse.json({
      admin: {
        // Fixed UUID — see the note on the mock in `verify/route.ts`.
        id: '00000000-0000-4000-8000-000000000001',
        email: 'ops@towing.local',
        name: 'Mock Admin',
        subRole: 'operations',
      },
    });
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Not signed in' } },
      { status: 401 },
    );
  }

  const upstream = await fetch(`${env.apiBaseUrl}/v1/admin/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Sign-in service unavailable' } },
      { status: 502 },
    );
  }

  if (upstream.status === 401) {
    const response = NextResponse.json(
      { error: { code: 'unauthorized', message: 'Session expired — sign in again' } },
      { status: 401 },
    );
    clearAdminSessionCookies(response);
    return response;
  }

  // Success and non-401 errors (e.g. 403 for a deactivated admin) pass
  // through with their status, so the provider can tell "signed out" apart
  // from "signed in but not allowed".
  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json(
      body ?? { error: { code: 'internal_error', message: 'Request failed' } },
      { status: upstream.status },
    );
  }
  return NextResponse.json({ admin: body });
}
