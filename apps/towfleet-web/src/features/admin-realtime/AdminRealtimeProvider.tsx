'use client';

import { createContext, useContext, useEffect, useState } from 'react';
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
 * Owns the `/admin` socket for the console (W1 §3.4).
 *
 * MOCK MODE CONNECTS NOTHING, on purpose: the mock console is hermetic and has
 * no ticket route, so the provider reports `polling` — which is exactly what a
 * screen must handle anyway (§19.2), and keeps every mocks-on spec from opening
 * a socket it cannot authenticate. The live branch mirrors the fleet provider's
 * discipline: handlers live in refs so the effect depends on nothing that
 * changes per render.
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
  const [mode, setMode] = useState<RealtimeMode>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    return adminRealtimeConnection.acquire({
      onMode: setMode,

      onResync: () => {
        // §18: the transport guarantees a resync hook on every (re)connect.
        // No admin query consumes live frames YET — W3's dashboard patches its
        // keys from `ops:metrics` in this hook, and W4's map from
        // `location:update`. It stays empty until a frame has a consumer, so
        // there is nothing here that can look like a loaded feature.
      },

      onBookingStatus: () => setLastEventAt(Date.now()),
      onLocationUpdate: () => setLastEventAt(Date.now()),
    });
  }, []);

  return (
    <AdminRealtimeContext.Provider value={{ mode, lastEventAt }}>
      {children}
    </AdminRealtimeContext.Provider>
  );
}
