'use client';

import {
  BarChart3,
  Bell,
  Briefcase,
  Calculator,
  Car,
  Compass,
  CreditCard,
  FileSearch,
  FileText,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  Map,
  Megaphone,
  Percent,
  Scale,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { cn } from '@towing/web-ui';
import type { AdminPermission } from '@towing/api-contracts';
import { useAdminCan } from '@/components/admin/Can';

/**
 * The admin console's sidebar — Modern SaaS refresh.
 *
 * Grouped + collapsible (default EXPANDED per operator preference), with a
 * filter box when expanded. Items stay permission-filtered by the SAME map
 * the server enforces, badges still come from `ops:badges`, and every link
 * keeps its `data-testid="admin-nav-<id>"` for the Playwright shell spec.
 *
 * WHY `Verification` AND `Drivers` HOLD DIFFERENT PATHS: the KYC queue has
 * lived at `/admin/drivers` since Phase 11 and keeps that path (it IS the
 * verification screen); W6's driver DIRECTORY gets `/admin/drivers/list`.
 */
interface AdminNavItem {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** `null` = every admin (self-service screens). */
  permission: AdminPermission | null;
  group: AdminNavGroup;
}

type AdminNavGroup = 'Overview' | 'Work queues' | 'Directory' | 'Money' | 'Platform' | 'System';

const GROUP_ORDER: readonly AdminNavGroup[] = [
  'Overview',
  'Work queues',
  'Directory',
  'Money',
  'Platform',
  'System',
];

const NAV_ITEMS: readonly AdminNavItem[] = [
  {
    id: 'dashboard',
    href: '/admin',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permission: 'ops.live',
    group: 'Overview',
  },
  {
    id: 'verification',
    href: '/admin/drivers',
    label: 'Verification',
    icon: FileSearch,
    permission: 'kyc.read',
    group: 'Work queues',
  },
  { id: 'ops', href: '/admin/ops', label: 'Live Ops', icon: Map, permission: 'ops.live', group: 'Work queues' },
  {
    id: 'bookings',
    href: '/admin/bookings',
    label: 'Bookings',
    icon: Briefcase,
    permission: 'booking.read',
    group: 'Work queues',
  },
  {
    id: 'disputes',
    href: '/admin/disputes',
    label: 'Disputes',
    icon: Scale,
    permission: 'dispute.handle',
    group: 'Work queues',
  },
  {
    id: 'support',
    href: '/admin/support',
    label: 'Support',
    icon: LifeBuoy,
    permission: 'ticket.handle',
    group: 'Work queues',
  },
  { id: 'sos', href: '/admin/sos', label: 'SOS', icon: ShieldAlert, permission: 'sos.handle', group: 'Work queues' },
  { id: 'users', href: '/admin/users', label: 'Users', icon: Users, permission: 'user.read', group: 'Directory' },
  {
    id: 'drivers',
    href: '/admin/drivers/list',
    label: 'Drivers',
    icon: Car,
    permission: 'user.read',
    group: 'Directory',
  },
  {
    id: 'fleets',
    href: '/admin/fleets',
    label: 'Fleets',
    icon: ShieldCheck,
    permission: 'user.read',
    group: 'Directory',
  },
  {
    id: 'finance',
    href: '/admin/finance',
    label: 'Finance',
    icon: Wallet,
    permission: 'finance.read',
    group: 'Money',
  },
  {
    id: 'pricing',
    href: '/admin/pricing',
    label: 'Pricing',
    icon: Tags,
    permission: 'pricing.edit',
    group: 'Money',
  },
  {
    id: 'commission',
    href: '/admin/commission',
    label: 'Commission',
    icon: Percent,
    // W11: `commission.propose` rather than `commission.edit`, so Operations —
    // who propose and who cannot set a rate — can reach the screen to do it.
    permission: 'commission.propose',
    group: 'Money',
  },
  {
    id: 'quotes',
    href: '/admin/quotes',
    label: 'Quotes',
    icon: Calculator,
    permission: 'quote.manage',
    group: 'Money',
  },
  {
    id: 'dispatch',
    href: '/admin/dispatch',
    label: 'Dispatch',
    icon: Compass,
    permission: 'dispatch.config',
    group: 'Platform',
  },
  { id: 'zones', href: '/admin/zones', label: 'Zones', icon: Gauge, permission: 'zone.edit', group: 'Platform' },
  {
    id: 'promotions',
    href: '/admin/promotions',
    label: 'Promotions',
    icon: Megaphone,
    permission: 'promo.manage',
    group: 'Platform',
  },
  {
    id: 'content',
    href: '/admin/content',
    label: 'Content',
    icon: FileText,
    permission: 'content.edit',
    group: 'Platform',
  },
  {
    id: 'analytics',
    href: '/admin/analytics',
    label: 'Analytics',
    icon: BarChart3,
    // W17: reading is its own permission (all four roles); the export button
    // inside the page stays behind `analytics.export`.
    permission: 'analytics.view',
    group: 'Platform',
  },
  {
    id: 'privacy',
    href: '/admin/privacy',
    label: 'Privacy',
    icon: ShieldCheck,
    permission: 'privacy.handle',
    group: 'Platform',
  },
  {
    id: 'admins',
    href: '/admin/admins',
    label: 'Admins',
    icon: CreditCard,
    permission: 'admin.manage',
    group: 'System',
  },
  { id: 'audit', href: '/admin/audit', label: 'Audit', icon: Bell, permission: 'audit.read', group: 'System' },
  {
    id: 'notifications',
    href: '/admin/settings/notifications',
    label: 'Notifications',
    icon: Send,
    permission: 'notification.view',
    group: 'System',
  },
  // Self-service (2FA, sessions) — every admin, no permission gate.
  {
    id: 'settings',
    href: '/admin/settings/security',
    label: 'Settings',
    icon: Settings,
    permission: null,
    group: 'System',
  },
];

export function AdminSidebar({
  badges,
  collapsed,
  mobileOpen,
  onCloseMobile,
}: {
  badges?: Record<string, number>;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}): React.ReactNode {
  const pathname = usePathname();
  const can = useAdminCan();
  const [filter, setFilter] = useState('');

  const visible = useMemo(
    () => NAV_ITEMS.filter((item) => item.permission === null || can(item.permission)),
    [can],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((item) => item.label.toLowerCase().includes(q));
  }, [visible, filter]);

  const renderLink = (item: { id: string; href: string; label: string; icon: LucideIcon }) => {
    // `/admin` would match every page with a bare prefix test; the
    // dashboard is active only at the root.
    const active =
      item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
    const badge = badges?.[item.id];
    const Icon = item.icon;
    return (
      <Link
        key={item.id}
        href={item.href}
        data-testid={`admin-nav-${item.id}`}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        onClick={onCloseMobile}
        className={cn(
          'group flex items-center gap-3 rounded-input px-3 py-2 text-sm font-medium transition-all duration-150',
          collapsed && 'justify-center px-2',
          active
            ? 'bg-brand text-on-brand shadow-[0_2px_8px_rgba(0,0,0,0.15)]'
            : 'text-text-secondary hover:translate-x-px hover:bg-surface1 hover:text-text-primary',
        )}
      >
        <Icon className="size-4 shrink-0" />
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!collapsed && badge !== undefined && badge > 0 ? (
          <span
            data-testid={`admin-nav-badge-${item.id}`}
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
              active ? 'bg-white/20 text-white' : 'bg-brand-tint text-brand',
            )}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
        {collapsed && badge !== undefined && badge > 0 ? (
          <span
            data-testid={`admin-nav-badge-${item.id}`}
            className="absolute ml-6 mt-[-14px] rounded-full bg-error px-1.5 py-px text-[10px] font-bold text-white"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </Link>
    );
  };

  const desktopNav = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Admin sections">
      {!collapsed && (
        <div className="relative mb-2">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sections"
            aria-label="Filter admin sections"
            className="h-8 w-full rounded-input border border-border bg-surface0 pl-8 pr-7 text-xs text-text-primary placeholder:text-text-tertiary focus-visible:border-brand focus-visible:outline-none"
          />
          {filter ? (
            <button
              type="button"
              aria-label="Clear section filter"
              onClick={() => setFilter('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-tertiary hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      )}
      {GROUP_ORDER.map((group) => {
        const items = filtered.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="mb-1">
            {!collapsed && (
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                {group}
              </p>
            )}
            {collapsed && group !== GROUP_ORDER[0] ? (
              <div className="mx-3 my-1 border-t border-border" aria-hidden />
            ) : null}
            <div className="flex flex-col gap-0.5">{items.map(renderLink)}</div>
          </div>
        );
      })}
      {filtered.length === 0 ? (
        <p className="px-3 py-4 text-xs text-text-tertiary">No sections match “{filter}”.</p>
      ) : null}
    </nav>
  );

  return (
    <>
      {/* Desktop — fixed width, collapsible, default expanded. */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out lg:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className={cn('flex h-14 items-center px-5', collapsed && 'justify-center px-2')}>
          <span
            className={cn(
              'font-display text-lg font-bold text-brand transition-all',
              collapsed && 'text-base',
            )}
          >
            {collapsed ? 'TA' : 'Towing Admin'}
          </span>
        </div>
        {desktopNav}
        {!collapsed && (
          <div className="border-t border-border p-3">
            <p className="rounded-input bg-surface1 px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
              Press{' '}
              <kbd className="rounded border border-border-strong bg-card px-1 font-mono text-[10px]">
                ⌘K
              </kbd>{' '}
              to jump anywhere.
            </p>
          </div>
        )}
      </aside>

      {/* Mobile — overlay drawer. */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Admin navigation">
          <div
            className="animate-admin-fade-in absolute inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden
          />
          <aside className="animate-admin-drawer-in absolute left-0 top-0 flex h-full w-72 flex-col border-r border-border bg-card shadow-2xl">
            <div className="flex h-14 items-center justify-between px-5">
              <span className="font-display text-lg font-bold text-brand">Towing Admin</span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={onCloseMobile}
                className="rounded-input p-1.5 text-text-secondary hover:bg-surface1 hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav
              className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3"
              aria-label="Admin sections"
            >
              {GROUP_ORDER.map((group) => {
                const items = visible.filter((item) => item.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="mb-1">
                    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                      {group}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {items.map((item) => {
                        const active =
                          item.href === '/admin'
                            ? pathname === '/admin'
                            : pathname.startsWith(item.href);
                        const badge = badges?.[item.id];
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.id}
                            href={item.href}
                            data-testid={`admin-nav-${item.id}`}
                            aria-current={active ? 'page' : undefined}
                            onClick={onCloseMobile}
                            className={cn(
                              'flex items-center gap-3 rounded-input px-3 py-2 text-sm font-medium',
                              active
                                ? 'bg-brand text-on-brand'
                                : 'text-text-secondary hover:bg-surface1 hover:text-text-primary',
                            )}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span className="flex-1">{item.label}</span>
                            {badge !== undefined && badge > 0 ? (
                              <span
                                data-testid={`admin-nav-badge-${item.id}`}
                                className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand tabular-nums"
                              >
                                {badge > 99 ? '99+' : badge}
                              </span>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}

/** Exported for the Playwright shell spec, so the assertion list cannot drift. */
export const ADMIN_NAV_ITEM_IDS = NAV_ITEMS.map((item) => item.id);

/** Navigation metadata for the command palette — same source, no drift. */
export const ADMIN_NAV_COMMANDS = NAV_ITEMS.map((item) => ({
  id: item.id,
  href: item.href,
  label: item.label,
  group: item.group,
  permission: item.permission,
}));
