import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import { applyNotificationData, type NotificationAction } from './handleNotificationData';
import { destinationFor } from './pushRoutes';
import { navigationRef } from '@/navigation/navigationRef';
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

    const subscriptions = addNotificationListeners({
      onReceived: (data) => {
        applyNotificationData(data, queryClient);
      },
      onTapped: (data) => {
        // WIRED IN PHASE 19. `applyNotificationData` has returned a
        // `NotificationAction` since Phase 13 and this callback threw it away,
        // because until money screens existed there was nowhere for a
        // customer's notification to lead. The previous comment here named
        // phases "15/17/19" as the owners; this is the last of them.
        navigateTo(applyNotificationData(data, queryClient));
      },
      onTokenChanged: (token) => {
        void registerRotatedToken(token);
      },
    });

    void (async () => {
      const initial = await getInitialNotificationData();
      if (!initial) return;

      // COLD START: the app was launched BY the notification, so the navigator
      // may not have mounted yet. `navigateTo` checks `isReady()` and drops the
      // navigation rather than throwing — the invalidation still runs, so the
      // customer lands on a correct screen even if not the intended one.
      navigateTo(applyNotificationData(initial, queryClient));
    })();

    return () => subscriptions.remove();
  }, [status, queryClient]);
}


/**
 * Follows a notification's route, if it has one this app recognises.
 *
 * Silent on every failure, deliberately: an unrecognised route, a navigator
 * that has not mounted, or a driver-app deep link on a customer device should
 * all leave the customer looking at the app rather than at an error.
 */
function navigateTo(action: NotificationAction): void {
  const destination = destinationFor(action);
  if (!destination || !navigationRef.isReady()) return;

  if (destination.screen === 'BookingDetails') {
    // NESTED, not a root route. `BookingDetails` lives inside the Bookings
    // tab's own stack — deliberately, so the tab bar stays visible on it — so
    // reaching it from outside means naming the whole path.
    navigationRef.navigate('Tabs', {
      screen: 'Bookings',
      params: { screen: 'BookingDetails', params: destination.params },
    });
    return;
  }
  if (destination.screen === 'Tracking') {
    navigationRef.navigate('Tracking', destination.params);
    return;
  }
  navigationRef.navigate(destination.screen);
}
