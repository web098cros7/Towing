import { useEffect } from 'react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { devicesDataSource } from '../api/devicesDataSource';
import { getInstallationId } from './installationId';
import { track } from '@/lib/analytics/analytics';
import {
  currentPlatform,
  getPermission,
  getPushToken,
  pushAvailability,
  requestPermission,
} from './pushClient';

/**
 * Registers this install with the server whenever there is a session.
 *
 * ⚠ GATED ON `status === 'authenticated'`, NOT hooked onto `useVerifyOtp`.
 * Hanging it off the login mutation would miss the far more common case — an
 * app opened with a session already hydrated from MMKV, which is every launch
 * after the first. Re-registering on each launch is also how `last_seen_at` and
 * the app-version field stay true.
 *
 * REGISTRATION HAPPENS EVEN WITHOUT PERMISSION, with a null token. The row is
 * what lets the server know this install exists; it flips to a real token if
 * the user grants permission later, with no separate "now create it" path.
 *
 * ⚠ NEVER EXECUTED. No build exists for this app, so no token has ever been
 * minted and this has never run against the real `expo-notifications`.
 */
export function usePushRegistration(): void {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;

    void (async () => {
      const availability = pushAvailability();

      let permission = availability.available ? await getPermission() : 'denied';

      /**
       * MiTow Driver ASKS; the customer app primes first.
       *
       * The customer app shows a priming sheet before the OS prompt, because a
       * customer who declines has lost nothing they understand yet. A driver's
       * livelihood runs through this channel — Phase 17's job offers arrive by
       * push and expire in 20 seconds — so the ask needs no persuading, and an
       * extra screen between sign-in and being able to work is friction with no
       * upside. The B2 slice does not call for a priming sheet either.
       *
       * Asked once, on the first authenticated launch: `undetermined` is the
       * only state where the OS will show anything at all.
       */
      if (permission === 'undetermined') {
        permission = await requestPermission();
        track(permission === 'granted' ? 'push_permission_granted' : 'push_permission_denied');
      }

      // Still register, with a null token: knowing the install exists is
      // useful even where remote push cannot work (Expo Go, simulator) or
      // where the driver declined.
      const token =
        availability.available && permission === 'granted' ? await getPushToken() : null;

      if (cancelled) return;

      try {
        await devicesDataSource.register({
          installationId: getInstallationId(),
          pushToken: token,
          platform: currentPlatform(),
        });
      } catch {
        // A failed registration must never surface to the user or block the
        // app: they signed in successfully, and the next launch retries.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);
}

/**
 * Re-registers after the OS hands us a rotated token.
 *
 * Expo tokens are not permanent. Without this the server keeps a dead token and
 * every push to it silently fails until the next app launch — which for a
 * customer app can be weeks.
 */
export async function registerRotatedToken(pushToken: string): Promise<void> {
  if (useAuthStore.getState().status !== 'authenticated') return;

  try {
    await devicesDataSource.register({
      installationId: getInstallationId(),
      pushToken,
      platform: currentPlatform(),
    });
  } catch {
    // Same reasoning as above.
  }
}

/**
 * Logout's half of invariant 73.
 *
 * The server also revokes on suspension and account deletion, because a client
 * cannot be relied on to tell it — but the ordinary logout is the common case,
 * and leaving it to the server would mean every clean sign-out still leaves a
 * live token on the handset until something else notices.
 */
export async function unregisterThisDevice(): Promise<void> {
  try {
    await devicesDataSource.unregister(getInstallationId());
  } catch {
    // Best-effort by design: a network failure here must not stop the user
    // signing out. The server revokes the row on its own next.
  }
}
