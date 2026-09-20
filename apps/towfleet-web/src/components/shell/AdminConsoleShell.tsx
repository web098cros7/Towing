'use client';

import type { ReactNode } from 'react';
import type { AdminOpsBadges } from '@towing/api-contracts';
import {
  AdminRealtimeProvider,
  useAdminRealtime,
} from '@/features/admin-realtime/AdminRealtimeProvider';
import { SosBanner } from '@/features/admin-sos/components/SosBanner';
import { ToastProvider } from '@/components/admin/ToastProvider';
import { useAdminCan } from '@/components/admin/Can';
import { useAdminIdleLogout } from '@/components/admin/useAdminIdleLogout';
import { useAdminOpsBadges } from '@/features/admin-ops/api/adminOps.queries';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

/**
 * The W1 console shell (§3.2): permission-filtered sidebar + topbar + main,
 * with toasts, the 30-minute idle logout and the `/admin` socket connection
 * mounted once for the whole subtree.
 *
 * A client component because three of those four things hold state or timers;
 * the layout above it stays a server component so the route tree keeps its
 * server boundary.
 *
 * `ToastProvider` WRAPS THE REALTIME PROVIDER since W14: the socket handler
 * raises an SOS toast (and the chime) the instant the frame lands, and that is
 * the one alert in the console that must not wait for a query to refetch.
 *
 * W3 wires the sidebar badges: `ops:badges` frames patch the cached badge
 * query inside `ConsoleFrame`, which is a child of the realtime provider for
 * exactly that reason — the badge count and the socket share one connection.
 * W14 adds the persistent SOS banner between the topbar and the page.
 */
export function AdminConsoleShell({ children }: { children: ReactNode }): ReactNode {
  useAdminIdleLogout();

  return (
    <ToastProvider>
      <AdminRealtimeProvider>
        <ConsoleFrame>{children}</ConsoleFrame>
      </AdminRealtimeProvider>
    </ToastProvider>
  );
}

function ConsoleFrame({ children }: { children: ReactNode }): ReactNode {
  const can = useAdminCan();
  const { mode } = useAdminRealtime();
  const badges = useAdminOpsBadges(can('ops.live'), mode);

  return (
    <div className="flex min-h-screen">
      <AdminSidebar badges={badges.data ? navBadges(badges.data.badges) : undefined} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar />
        <SosBanner />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

/**
 * Badge payload keys → sidebar nav ids. The sidebar owns presentation; this is
 * the only place the two vocabularies meet, so a renamed nav id breaks here
 * loudly instead of a badge silently disappearing.
 */
function navBadges(badges: AdminOpsBadges): Record<string, number> {
  return {
    verification: badges.pendingKyc,
    finance: badges.pendingPayouts,
    sos: badges.openSos,
    disputes: badges.openDisputes,
    support: badges.openTickets,
    users: badges.suspensionRequests,
    privacy: badges.deletionRequests,
  };
}
