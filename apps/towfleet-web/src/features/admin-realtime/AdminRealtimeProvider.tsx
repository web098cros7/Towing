'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AdminOpsBadgesResponse, AdminOpsLiveResponse } from '@towing/api-contracts';
import { adminOpsKeys } from '@/features/admin-ops/api/adminOps.keys';
import { dashboardFromMetrics } from '@/features/admin-ops/lib/dashboardFromMetrics';
import { adminSosKeys } from '@/features/admin-sos/api/adminSos.keys';
import { playSosChime } from '@/features/admin-sos/lib/sosChime';
import type { RealtimeMode } from '@/features/realtime/types';
import { useToast } from '@/components/admin/ToastProvider';
import { env } from '@/lib/env';
import { adminRealtimeConnection } from './lib/socket';

interface AdminRealtimeContextValue {
  mode: RealtimeMode;
  /** When the last frame landed — powers status chips and activity dots. */
  lastEventAt: number | null;
}

const AdminRealtimeContext = createContext<AdminRealtimeContextValue>({
  mode: 'polling',
  lastEventAt: null,
});

export function useAdminRealtime(): AdminRealtimeContextValue {
  return useContext(AdminRealtimeContext);
}

/**
 * Owns the `/admin` socket for the console (W1 §3.4) and patches the query
 * cache from it (W3).
 *
 * MOCK MODE CONNECTS NOTHING, on purpose: the mock console is hermetic and has
 * no ticket route, so the provider reports `polling` — which is exactly what a
 * screen must handle anyway (§19.2), and keeps every mocks-on spec from opening
 * a socket it cannot authenticate. The live branch mirrors the fleet provider's
 * discipline: handlers live in refs so the effect depends on nothing that
 * changes per render, and the socket is never treated as complete — `onResync`
 * invalidates every ops key on each (re)connect.
 */
export function AdminRealtimeProvider({ children }: { children: React.ReactNode }) {
  return env.useMocks ? (
    <AdminRealtimeMockProvider>{children}</AdminRealtimeMockProvider>
  ) : (
    <AdminRealtimeLiveProvider>{children}</AdminRealtimeLiveProvider>
  );
}

function AdminRealtimeMockProvider({ children }: { children: React.ReactNode }) {
  return (
    <AdminRealtimeContext.Provider value={{ mode: 'polling', lastEventAt: null }}>
      {children}
    </AdminRealtimeContext.Provider>
  );
}

function AdminRealtimeLiveProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<RealtimeMode>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  // The socket effect must not re-run when the toast identity changes; the
  // callback is stable for the life of the provider in practice, but a ref
  // keeps the dependency list honest.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const client = queryClientRef.current;

    // Booking frames arrive per transition; invalidating the feed on every one
    // would hammer it during a busy minute. One trailing refresh per burst.
    const scheduleActivityRefresh = () => {
      if (activityTimer.current) clearTimeout(activityTimer.current);
      activityTimer.current = setTimeout(() => {
        void client.invalidateQueries({ queryKey: adminOpsKeys.activity() });
      }, 2_000);
    };

    const release = adminRealtimeConnection.acquire({
      onMode: setMode,

      onResync: () => {
        // §18: never trust socket completeness — refetch authoritative state
        // on every (re)connect. W3's dashboard and W4's map share these keys.
        void client.invalidateQueries({ queryKey: adminOpsKeys.all });
      },

      onBookingStatus: (event) => {
        setLastEventAt(Date.now());
        // Patch every cached live snapshot (the key is filter-parameterised):
        // the frame carries status + zone + driver, so a booking that left the
        // active set disappears from the layer without waiting for a refetch,
        // and one that changed driver re-links its leg immediately. Unknown
        // bookings are dropped — identity comes from REST, exactly like the
        // fleet map's trucks.
        client.setQueriesData<AdminOpsLiveResponse>(
          { queryKey: [...adminOpsKeys.all, 'live'] },
          (previous) => {
            if (!previous) return previous;
            let changed = false;
            const bookings = previous.bookings.map((booking) => {
              if (booking.bookingId !== event.bookingId) return booking;
              changed = true;
              return {
                ...booking,
                status: event.status,
                zoneId: event.zoneId,
                driverId: event.driverId,
              };
            });
            return changed ? { ...previous, bookings } : previous;
          },
        );
        scheduleActivityRefresh();
      },

      onLocationUpdate: (event) => {
        setLastEventAt(Date.now());
        // Merge positions into every cached live snapshot by driver id: a
        // frame for a driver the snapshot does not list is not ours to render
        // — the resync that lands will include them properly.
        client.setQueriesData<AdminOpsLiveResponse>(
          { queryKey: [...adminOpsKeys.all, 'live'] },
          (previous) => {
            if (!previous) return previous;
            const byDriver = new Map(previous.drivers.map((driver) => [driver.driverId, driver]));
            for (const incoming of event.positions) {
              const existing = byDriver.get(incoming.driverId);
              if (!existing) continue;
              byDriver.set(incoming.driverId, {
                ...existing,
                lat: incoming.lat,
                lng: incoming.lng,
                headingDeg: incoming.headingDeg,
                speedKph: incoming.speedKph,
                at: incoming.at,
                zoneId: incoming.zoneId ?? existing.zoneId,
                fromFallback: false,
              });
            }
            return { ...previous, drivers: [...byDriver.values()] };
          },
        );
      },

      onOpsMetrics: (event) => {
        setLastEventAt(Date.now());
        // The frame IS the dashboard's next state — the backend's broadcaster
        // recomputes through the same service the REST endpoint serves, and its
        // e2e pins the two payloads identical.
        client.setQueryData(adminOpsKeys.dashboard(), dashboardFromMetrics(event));
      },

      onOpsBadges: (event) => {
        client.setQueryData<AdminOpsBadgesResponse>(adminOpsKeys.badges(), (previous) =>
          previous ? { ...previous, badges: event.badges, at: event.at } : previous,
        );
      },

      onSosAlert: (event) => {
        setLastEventAt(Date.now());
        // Invalidate rather than patch: the frame carries the ids and the
        // position, and the queue's rows carry names, ack latencies and the
        // subject join — a patched row would be a second, thinner shape the
        // table would have to render. `sosKeys.all` covers the queue, the
        // banner's open list and any open detail. The badge refresh makes the
        // sidebar agree even before the broadcaster's next tick.
        void client.invalidateQueries({ queryKey: adminSosKeys.all });
        void client.invalidateQueries({ queryKey: adminOpsKeys.badges() });

        // §13's ops alerting: an audible chime and a toast the moment the
        // frame lands, in addition to the persistent banner — the banner is
        // driven by DATA (it survives reload and polling mode), the sound and
        // the toast cannot be, because nothing else knows the instant.
        playSosChime();
        toastRef.current(
          event.duplicate
            ? `SOS repeated — same incident (${event.subjectType})`
            : 'SOS alert — open the SOS console',
          'error',
        );
      },
    });

    return () => {
      release();
      if (activityTimer.current) clearTimeout(activityTimer.current);
      activityTimer.current = null;
    };
  }, []);

  return (
    <AdminRealtimeContext.Provider value={{ mode, lastEventAt }}>
      {children}
    </AdminRealtimeContext.Provider>
  );
}
