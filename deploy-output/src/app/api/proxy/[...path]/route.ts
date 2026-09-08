import { REFRESH_COOKIE, SESSION_COOKIE, clearSessionCookies, setSessionCookies } from '@/lib/session';
import { createProxyHandler } from '@/lib/createProxyHandler';

/**
 * BFF proxy for the fleet console: `/api/proxy/<path>` → `/v1/fleet/<path>`.
 * The shared mechanics (refresh serialization, header handling) live in
 * `createProxyHandler` — see that file for the reasoning.
 */
export const { GET, POST, PUT, DELETE } = createProxyHandler({
  upstreamPrefix: 'fleet',
  sessionCookie: SESSION_COOKIE,
  refreshCookie: REFRESH_COOKIE,
  setSessionCookies,
  clearSessionCookies,
});
