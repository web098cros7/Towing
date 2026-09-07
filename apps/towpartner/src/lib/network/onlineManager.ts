import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { flushMutationQueue } from '@/lib/api/client';
import * as locationService from '@/lib/location/driverLocationService';
import { reconnectDriverSocket } from '@/lib/realtime/driverSocket';
import { useDriverStatusStore } from '@/features/dashboard/store/driverStatusStore';

/**
 * Bridge device connectivity into TanStack Query's onlineManager so queries
 * pause/refetch correctly across network drops (spec §10.9), flush the
 * durable mutation queue on reconnect, and bridge app foreground/background
 * into `focusManager` so a query opted into `refetchOnWindowFocus` (e.g.
 * `useKycStatus()`) re-pulls the moment the driver returns to the app —
 * React Native has no browser focus event, so nothing does this by default.
 * Call once at boot.
 */
export function initOnlineManager(): void {
  let wasOffline = false;

  onlineManager.setEventListener((setOnline) => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected !== false;
      setOnline(isOnline);

      // Edge-triggered: only flush on the offline→online transition, not on
      // every connectivity event NetInfo happens to fire.
      if (isOnline && wasOffline) {
        flushMutationQueue().catch(() => {});

        /**
         * §11.6's "pings buffer locally on signal loss and flush IN ORDER on
         * reconnect" — the half that was missing (Phase 18).
         *
         * The buffer has existed since Phase 16 and is correct: MMKV-backed,
         * ordered, cleared against the server's own sequence. What was never
         * wired is the reconnect trigger. `flush()` was called from exactly two
         * places — the end of the location task, and `stop()` — so a driver
         * coming out of a tunnel waited for the NEXT location tick before their
         * backlog moved. At the on-job cadence that is three seconds and barely
         * matters; at the idle cadence it is ten, and if the tunnel was long
         * enough that the OS suspended the task, it is until the driver next
         * looks at their phone.
         *
         * That gap is also exactly what the phase's airplane-mode verification
         * asserts, which is how it was found.
         */
        locationService.flush().catch(() => {});

        /**
         * And the socket, for the same reason and with the same history.
         *
         * `reconnectDriverSocket` was written in Phase 16 and had NO CALLER
         * anywhere in the app. The `/driver` socket sets `reconnection: false`
         * because its ticket is single-use, so a connection dropped mid-shift
         * stayed dropped until the driver toggled offline and back — and a
         * driver with no socket gets no `job:offer` frame, which is the whole
         * product. The push still reaches them, but the push is the fallback.
         */
        if (useDriverStatusStore.getState().isOnline) {
          reconnectDriverSocket().catch(() => {});
        }
      }
      wasOffline = !isOnline;
    });
    return unsubscribe;
  });

  const onAppStateChange = (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  };
  AppState.addEventListener('change', onAppStateChange);
}
