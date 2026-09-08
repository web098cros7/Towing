import {
  ADMIN_REFRESH_COOKIE,
  ADMIN_SESSION_COOKIE,
  clearAdminSessionCookies,
  setAdminSessionCookies,
} from '@/lib/adminSession';
import { createProxyHandler } from '@/lib/createProxyHandler';

/**
 * BFF proxy for the admin console: `/api/admin-proxy/<path>` → `/v1/admin/<path>`.
 */
export const { GET, POST, PUT, DELETE } = createProxyHandler({
  upstreamPrefix: 'admin',
  sessionCookie: ADMIN_SESSION_COOKIE,
  refreshCookie: ADMIN_REFRESH_COOKIE,
  setSessionCookies: setAdminSessionCookies,
  clearSessionCookies: clearAdminSessionCookies,
});
