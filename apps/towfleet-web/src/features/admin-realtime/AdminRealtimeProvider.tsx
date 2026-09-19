'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AdminOpsBadgesResponse } from '@towing/api-contracts';
import { adminOpsKeys } from '@/features/admin-ops/api/adminOps.keys';
import { dashboardFromMetrics } from '@/features/admin-ops/lib/dashboardFromMetrics';
import type { RealtimeMode } from '@/features/realtime/types';
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
  const [mode, setMode] = useState<RealtimeMode>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
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

      onBookingStatus: () => {
        setLastEventAt(Date.now());
        scheduleActivityRefresh();
      },

      onLocationUpdate: () => setLastEventAt(Date.now()),

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
