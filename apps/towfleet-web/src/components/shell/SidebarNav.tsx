'use client';

import {
  BarChart3,
  Bell,
  Briefcase,
  LayoutDashboard,
  Map,
  Search,
  Settings,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { cn } from '@towing/web-ui';

interface FleetNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly FleetNavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/map', label: 'Live Map', icon: Map },
  { href: '/trucks', label: 'Trucks', icon: Truck },
  { href: '/drivers', label: 'Drivers', icon: Users },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/earnings', label: 'Earnings', icon: Wallet },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Fleet console sidebar — collapsible (default expanded), filterable, with a
 * mobile overlay twin. Same routes as before; collapse state lives in
 * `FleetConsoleShell` and persists per browser.
 */
export function SidebarNav({
  collapsed,
  mobileOpen,
  onCloseMobile,
  alertCount,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  alertCount?: number;
}): React.ReactNode {
  const pathname = usePathname();
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q));
  }, [filter]);

  const renderLink = (item: FleetNavItem, onNavigate?: () => void) => {
    const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
    const Icon = item.icon;
    const badge = item.href === '/alerts' ? alertCount : undefined;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={collapsed && !onNavigate ? item.label : undefined}
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-3 rounded-input px-3 py-2 text-sm font-medium transition-all duration-150',
          collapsed && !onNavigate && 'justify-center px-2',
          active
            ? 'bg-brand text-on-brand shadow-[0_2px_8px_rgba(0,0,0,0.15)]'
            : 'text-text-secondary hover:translate-x-px hover:bg-surface1 hover:text-text-primary',
        )}
      >
        <Icon className="size-4 shrink-0" />
        {collapsed && !onNavigate ? null : <span className="flex-1 truncate">{item.label}</span>}
        {collapsed && !onNavigate ? null : badge !== undefined && badge > 0 ? (
          <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-semibold text-error tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop */}
      <div className="hidden h-full flex-col lg:flex">
        {!collapsed && (
          <div className="relative mb-2 px-3">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary"
            />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter sections"
              aria-label="Filter fleet sections"
              className="h-8 w-full rounded-input border border-border bg-surface0 pl-8 pr-7 text-xs text-text-primary placeholder:text-text-tertiary focus-visible:border-brand focus-visible:outline-none"
            />
            {filter ? (
              <button
                type="button"
                aria-label="Clear section filter"
                onClick={() => setFilter('')}
                className="absolute right-5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-tertiary hover:text-text-primary"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        )}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3" aria-label="Fleet sections">
          {visible.map((item) => renderLink(item))}
          {visible.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-tertiary">No sections match “{filter}”.</p>
          ) : null}
        </nav>
        {!collapsed && (
          <div className="px-3 pb-1">
            <p className="rounded-input bg-surface1 px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
              Press{' '}
              <kbd className="rounded border border-border-strong bg-card px-1 font-mono text-[10px]">
                ⌘K
              </kbd>{' '}
              to jump anywhere.
            </p>
          </div>
        )}
      </div>

      {/* Mobile overlay */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Fleet navigation">
          <div
            className="animate-admin-fade-in absolute inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden
          />
          <aside className="animate-admin-drawer-in absolute left-0 top-0 flex h-full w-72 flex-col border-r border-border bg-card shadow-2xl">
            <div className="flex h-14 items-center justify-between px-5">
              <span className="font-display text-xl font-bold text-brand">TowFleet</span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={onCloseMobile}
                className="rounded-input p-1.5 text-text-secondary hover:bg-surface1 hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Fleet sections">
              {NAV_ITEMS.map((item) => renderLink(item, onCloseMobile))}
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}

/** Navigation metadata for the fleet command palette — same source, no drift. */
export const FLEET_NAV_COMMANDS = NAV_ITEMS.map((item) => ({ href: item.href, label: item.label }));
