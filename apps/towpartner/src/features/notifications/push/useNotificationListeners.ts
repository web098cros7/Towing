import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DriverJob } from '@towing/api-contracts';
import { useAuthStore } from '@/features/auth/store/authStore';
import { offersKeys } from '@/features/offers/api/offers.keys';
import { navigationRef } from '@/navigation/navigationRef';
import { applyNotificationData, type NotificationAction } from './handleNotificationData';
import { destinationFor } from './pushRoutes';
import { ensureNotificationChannels } from './channels';
import {
  addNotificationListeners,
  configureForegroundPresentation,
  getInitialNotificationData,
} from './pushClient';
import { registerRotatedToken } from './usePushRegistration';

/**
 * Wires the three ways a notification reaches a running app, plus the fourth
 * that reaches a dead one.
 *
 *   FOREGROUND  `onReceived` — the OS banner shows over the app, and the bell's
 *               unread count has to move without a refetch of the whole feed.
 *   BACKGROUND  `onTapped` — the app was alive but not on screen.
 *   KILLED      `getInitialNotificationData` — a tap that cold-started the app.
 *               `addNotificationResponseReceivedListener` never fires for this,
 *               so without it a cold start from a tap lands on the home screen
 *               and the message is silently dropped.
 *   ROTATION    `onTokenChanged` — Expo re-mints tokens, and a stale one fails
 *               silently until the next launch.
 *
 * ⚠ NEVER EXECUTED — see `pushClient.ts`.
 */
export function useNotificationListeners(): void {
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status !== 'authenticated') return;

    configureForegroundPresentation();
    // Cheap and idempotent, and it has to happen before the first offer push
    // ever arrives — a channel created lazily on receipt is a channel the OS
    // has already decided how to present.
    void ensureNotificationChannels();

    /**
     * NAVIGATION FROM A TAP, AND ONLY FROM A TAP.
     *
     * `onReceived` must NOT call this: a foreground receive is a banner over
     * whatever the driver is doing, and yanking them off the screen they are
     * reading because a customer sent a message is the wrong behaviour. The
     * offer takeover is already driven by the offer cache, so a foreground
     * offer push does not need navigation either — the gate above the
     * navigator will show it.
     *
     * The held booking id is read from the cache at tap time rather than
     * captured in the closure: the driver may have accepted or finished a job
     * between the listener mounting and the tap, and the chat route needs the
     * CURRENT held booking, not the one that was held when the effect ran.
     *
     * COLD START: `navigationRef.isReady()` is false during the first render
     * pass, and a tap that killed the app arrives before the container has
     * mounted. Retrying once after 500 ms is the pragmatic fix — the container
     * mounts well within that, and a second miss is a genuinely broken state
     * that a third retry would not fix.
     */
    const navigateFor = (action: NotificationAction) => {
      const heldId =
        queryClient.getQueryData<DriverJob | null>(offersKeys.job())?.bookingId ?? null;
      const dest = destinationFor(action, heldId);
      if (!dest) return;

      const go = () => {
        if (!navigationRef.isReady()) return false;
        switch (dest.screen) {
          case 'OfferTakeover':
            navigationRef.navigate('OfferTakeover');
            break;
          case 'AssignedJob':
            navigationRef.navigate('AssignedJob');
            break;
          case 'JobChat':
            navigationRef.navigate('JobChat', dest.params);
            break;
          case 'Tabs':
            navigationRef.navigate('Tabs', { screen: 'Earnings' });
            break;
          case 'KycStatus':
            navigationRef.navigate('KycStatus');
            break;
          case 'HelpSupport':
            navigationRef.navigate('HelpSupport');
            break;
          case 'Notifications':
            navigationRef.navigate('Notifications');
            break;
        }
        return true;
      };

      if (go()) return;
      setTimeout(go, 500);
    };

    const subscriptions = addNotificationListeners({
      onReceived: (data) => {
        applyNotificationData(data, queryClient);
      },
      onTapped: (data) => {
        // The KYC branch inside `applyNotificationData` invalidates the status
        // query, which unlocks the online toggle; the route table then takes
        // the driver to the screen the notification was about.
        const action = applyNotificationData(data, queryClient);
        navigateFor(action);
      },
      onTokenChanged: (token) => {
        void registerRotatedToken(token);
      },
    });

    void (async () => {
      const initial = await getInitialNotificationData();
      if (!initial) return;
      const action = applyNotificationData(initial, queryClient);
      navigateFor(action);
    })();

    return () => subscriptions.remove();
  }, [status, queryClient]);
}
