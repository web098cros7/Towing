import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { REFRESH_COOKIE, clearSessionCookies } from '@/lib/session';

/**
 * Logout. Revokes the whole refresh-token family backend-side (real mode),
 * then clears both cookies regardless — signing out must never fail locally
 * because the backend was unreachable.
 */
export async function DELETE() {
  if (!env.useMocks) {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
    if (refreshToken) {
      await fetch(`${env.apiBaseUrl}/v1/fleet/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      }).catch(() => {});
    }
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
