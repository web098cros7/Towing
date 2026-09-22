'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FleetCommandPalette } from '@/components/fleet/FleetCommandPalette';
import { useDashboardSummary } from '@/features/dashboard/api/dashboard.queries';
import { SidebarNav } from './SidebarNav';
import { Topbar } from './Topbar';

const SIDEBAR_KEY = 'fleet-sidebar-collapsed';

/**
 * Fleet console shell — collapsible sidebar (default expanded), sticky
 * topbar with breadcrumbs + ⌘K palette, responsive main column. Mirrors the
 * admin shell's structure at a smaller scale (9 sections, no permission
 * filtering — every fleet owner sees every section).
 */
export function FleetConsoleShell({ children }: { children: ReactNode }): ReactNode {
  // Default EXPANDED (false = expanded), persisted per browser.
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { data: summary } = useDashboardSummary();

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

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen bg-surface0">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card py-5 transition-[width] duration-200 ease-out lg:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className={`mb-4 flex h-8 items-center ${collapsed ? 'justify-center px-2' : 'px-6'}`}>
          <span className={`font-display font-bold text-brand ${collapsed ? 'text-base' : 'text-xl'}`}>
            {collapsed ? 'TF' : 'TowFleet'}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarNav
            collapsed={collapsed}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
            alertCount={summary?.alerts.length}
          />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onOpenMobile={() => setMobileOpen(true)}
        />
        {/* Mobile overlay twin: the desktop aside is `hidden` below lg, which
            would hide a fixed overlay inside it too — so the overlay renders
            from this instance instead (its desktop half self-hides). */}
        <div className="lg:hidden">
          <SidebarNav
            collapsed={false}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
            alertCount={summary?.alerts.length}
          />
        </div>
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6">
          {/* Keyed by route for a subtle cross-fade — never by UI state. */}
          <div key={pathname} className="animate-admin-fade-in">
            {children}
          </div>
        </main>
      </div>
      <FleetCommandPalette />
    </div>
  );
}
