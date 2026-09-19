'use client';

import { useEffect } from 'react';

/**
 * 30-minute idle logout (§3.6, G15) — the CLIENT half of the admin session
 * policy. The server half is `ADMIN_SESSION_LIMITS.idleMs` in
 * `TokenService.rotate`, which is what actually refuses a stale family; this
 * hook exists so the operator sees a login screen instead of a wall of 401s on
 * their next click.
 *
 * Activity resets the clock with the SAME events the server counts as a
 * rotation (any authenticated request) — approximately: a user who only reads
 * a static page for 30 minutes gets logged out, which is the intended reading
 * of "sessions expire" (§9.4.1).
 */
export const ADMIN_IDLE_LOGOUT_MS = 30 * 60 * 1000;

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'visibilitychange',
] as const;

export function useAdminIdleLogout(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const expire = () => {
      // Revoke server-side too: leaving the cookie on a sleeping tab would let
      // the next click 401-loop until the BFF's refresh failed anyway.
      void fetch('/api/admin-session', { method: 'DELETE' })
        .catch(() => undefined)
        .finally(() => {
          window.location.assign('/admin/login');
        });
    };

    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(expire, ADMIN_IDLE_LOGOUT_MS);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }
    reset();

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reset);
      }
      if (timer) clearTimeout(timer);
    };
  }, []);
}
