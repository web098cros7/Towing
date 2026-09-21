'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AdminOpsBadges } from '@towing/api-contracts';
import {
  AdminRealtimeProvider,
  useAdminRealtime,
} from '@/features/admin-realtime/AdminRealtimeProvider';
import { SosBanner } from '@/features/admin-sos/components/SosBanner';
import { ToastProvider } from '@/components/admin/ToastProvider';
import { CommandPalette } from '@/components/admin/CommandPalette';
import { useAdminCan } from '@/components/admin/Can';
import { useAdminIdleLogout } from '@/components/admin/useAdminIdleLogout';
import { useAdminOpsBadges } from '@/features/admin-ops/api/adminOps.queries';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

const SIDEBAR_KEY = 'admin-sidebar-collapsed';

/**
 * The W1 console shell (§3.2) — Modern SaaS refresh: grouped collapsible
 * sidebar (default EXPANDED), sticky topbar with breadcrumbs + ⌘K palette,
 * responsive main column and the `/admin` socket mounted once for the subtree.
 *
 * `ToastProvider` WRAPS THE REALTIME PROVIDER since W14: the socket handler
 * raises an SOS toast (and the chime) the instant the frame lands, and that is
 * the one alert in the console that must not wait for a query to refetch.
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
  const pathname = usePathname();
  const { mode } = useAdminRealtime();
  const badges = useAdminOpsBadges(can('ops.live'), mode);

  // Default EXPANDED (false = expanded) per operator preference; persisted.
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_KEY);
      if (saved !== null) setCollapsed(saved === 'true');
    } catch {
      // Private mode — expanded default stands.
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, String(next));
      } catch {
        // Ignore persistence failures.
      }
      return next;
    });
  }, []);

  // Lock body scroll while the mobile nav is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen bg-surface0">
      <AdminSidebar
        badges={badges.data ? navBadges(badges.data.badges) : undefined}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <SosBanner />
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6">
          {/* Keyed by route for a subtle cross-fade — never by UI state, so
              toggling the sidebar or mobile nav never remounts the page. */}
          <div key={pathname} className="animate-admin-fade-in">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette />
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
