'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { dashboardKeys } from '@/features/dashboard/api/dashboard.keys';
import { jobsKeys } from '@/features/jobs/api/jobs.keys';
import { env } from '@/lib/env';
import { realtimeKeys } from './api/realtime.keys';
import { realtimeConnection } from './lib/socket';
import { mockPositionsAt, mockSnapshot } from './mocks/realtime.mock';
import type { PositionsSnapshot, RealtimeMode } from './types';

interface RealtimeContextValue {
  mode: RealtimeMode;
  /** When the last socket frame (or mock tick) landed — powers the chip's dot. */
  lastEventAt: number | null;
}

const RealtimeContext = createContext<RealtimeContextValue>({ mode: 'connecting', lastEventAt: null });

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/**
 * Owns the socket for the whole console and patches the query cache from it.
 *
 * Mounted inside QueryProvider in `(console)/layout.tsx`, so `useQueryClient`
 * resolves and every route shares one connection.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  return env.useMocks ? (
    <MockRealtimeProvider>{children}</MockRealtimeProvider>
  ) : (
    <LiveRealtimeProvider>{children}</LiveRealtimeProvider>
  );
}

function LiveRealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<RealtimeMode>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  // Handlers live in a ref so the effect below depends on nothing that changes
  // per render — remounting the socket on every state update would make the
  // reconnect loop fight itself.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    const client = queryClientRef.current;

    return realtimeConnection.acquire({
      onMode: setMode,

      onResync: () => {
        // §18: refetch authoritative state on every (re)connect rather than
        // assuming we saw every frame while disconnected.
        void client.invalidateQueries({ queryKey: realtimeKeys.positions() });
        void client.invalidateQueries({ queryKey: dashboardKeys.all });
      },

      onLocationUpdate: (event) => {
        setLastEventAt(Date.now());
        client.setQueryData<PositionsSnapshot>(realtimeKeys.positions(), (previous) => {
          // No snapshot yet means the resync is still in flight; dropping this
          // batch is correct — the snapshot that lands will be newer.
          if (!previous) return previous;

          const byTruck = new Map(previous.positions.map((p) => [p.truckId, p]));
          for (const incoming of event.positions) {
            const existing = byTruck.get(incoming.truckId);
            // A ping for a truck the snapshot does not list is not ours to
            // render: identity comes from REST, position from the socket.
            if (!existing) continue;
            byTruck.set(incoming.truckId, {
              ...existing,
              lat: incoming.lat,
              lng: incoming.lng,
              heading: incoming.heading,
              speedKph: incoming.speedKph,
              at: incoming.at,
              fromFallback: false,
            });
          }
          return { ...previous, positions: [...byTruck.values()] };
        });
      },

      onOpsMetrics: (event) => {
        setLastEventAt(Date.now());
        client.setQueryData<{ kpis: unknown; alerts: unknown }>(
          dashboardKeys.summary(),
          (previous) => (previous ? { ...previous, kpis: event.kpis } : previous),
        );
      },

      onBookingStatus: (event) => {
        setLastEventAt(Date.now());
        // Patch every cached filter variant...
        client.setQueriesData<{ items?: Array<{ id: string; status: string }> }>(
          { queryKey: jobsKeys.all },
          (previous) => {
            if (!previous?.items) return previous;
            return {
              ...previous,
              items: previous.items.map((job) =>
                job.id === event.bookingId ? { ...job, status: event.status } : job,
              ),
            };
          },
        );
        // ...then invalidate anyway: `jobsKeys.list(filter)` is
        // filter-parameterised, and a status change can move a job BETWEEN
        // filter buckets. Patching alone leaves the membership stale.
        void client.invalidateQueries({ queryKey: jobsKeys.all });
        void client.invalidateQueries({ queryKey: dashboardKeys.all });
      },
    });
  }, []);

  const value = useMemo(() => ({ mode, lastEventAt }), [mode, lastEventAt]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** Mock mode: no socket, no network — a local ticker drives the same cache key. */
function MockRealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    queryClient.setQueryData<PositionsSnapshot>(realtimeKeys.positions(), mockSnapshot(0));

    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      queryClient.setQueryData<PositionsSnapshot>(realtimeKeys.positions(), (previous) => ({
        positions: mockPositionsAt(tick),
        zones: previous?.zones ?? mockSnapshot(0).zones,
        at: new Date().toISOString(),
        degraded: false,
      }));
      setLastEventAt(Date.now());
    }, 1_000);

    return () => clearInterval(timer);
  }, [queryClient]);

  const value = useMemo<RealtimeContextValue>(
    () => ({ mode: 'mock' as const, lastEventAt }),
    [lastEventAt],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
