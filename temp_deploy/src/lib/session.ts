import type { NextResponse } from 'next/server';

/**
 * Fleet-realm session cookies. Both are httpOnly — the browser never sees a
 * token; the BFF proxy turns them into Authorization headers server-side.
 *
 * Both cookies live for the REFRESH TTL (30d): middleware only checks
 * presence, and the proxy transparently refreshes an expired access token. A
 * 15-minute cookie would bounce users to login while their session was still
 * perfectly refreshable.
 */
export const SESSION_COOKIE = 'fleet_session';
export const REFRESH_COOKIE = 'fleet_refresh';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const baseOptions = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
};

export function setSessionCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): void {
  response.cookies.set(SESSION_COOKIE, tokens.accessToken, baseOptions);
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, baseOptions);
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
}
