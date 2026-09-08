import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { ADMIN_REFRESH_COOKIE, clearAdminSessionCookies } from '@/lib/adminSession';

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
