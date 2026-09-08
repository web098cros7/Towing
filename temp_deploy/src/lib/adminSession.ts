import type { NextResponse } from 'next/server';

/**
 * Admin-realm session cookies (Phase 11) — same shape as `lib/session.ts`'s
 * fleet cookies, deliberately its own pair rather than a shared name: the
 * middleware and both proxies need to tell the two realms apart by cookie
 * name alone (§4.1 — separate web realms, no session bleed between them).
 */
export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_REFRESH_COOKIE = 'admin_refresh';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const baseOptions = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
};

export function setAdminSessionCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): void {
  response.cookies.set(ADMIN_SESSION_COOKIE, tokens.accessToken, baseOptions);
  response.cookies.set(ADMIN_REFRESH_COOKIE, tokens.refreshToken, baseOptions);
}

export function clearAdminSessionCookies(response: NextResponse): void {
  response.cookies.delete(ADMIN_SESSION_COOKIE);
  response.cookies.delete(ADMIN_REFRESH_COOKIE);
}
