'use client';

import {
  BarChart3,
  Bell,
  Briefcase,
  Car,
  Compass,
  CreditCard,
  FileSearch,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  Map,
  Megaphone,
  Percent,
  Scale,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@towing/web-ui';
import type { AdminPermission } from '@towing/api-contracts';
import { useAdminCan } from '@/components/admin/Can';

/**
 * The admin console's sidebar (§3.2, modelled on the fleet console's
 * `SidebarNav`).
 *
 * ITEMS ARE FILTERED BY PERMISSION, from the same map the server enforces:
 * an operator never sees a section they cannot open (the 403-instead-of-nav
 * problem A7 called out). The full 21-item list from the guide is here on
 * purpose — W3+ ships each page into an already-navigable shell rather than
 * growing the nav commit by commit.
 *
 * WHY `Verification` AND `Drivers` HOLD DIFFERENT PATHS: the KYC queue has
 * lived at `/admin/drivers` since Phase 11 and keeps that path (it IS the
 * verification screen); W6's driver DIRECTORY gets `/admin/drivers/list`.
 * Renaming the existing page would break bookmarks and the live specs for no
 * user-visible gain.
 *
 * Badges: the items accept a count from `ops:badges` (W1's realtime feed). The
 * prop exists and renders; the socket that fills it lands with W3's badge
 * broadcaster, so today every count is undefined rather than fabricated.
 */
interface AdminNavItem {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** `null` = every admin (self-service screens). */
  permission: AdminPermission | null;
}

const NAV_ITEMS: readonly AdminNavItem[] = [
  {
    id: 'dashboard',
    href: '/admin',
    label: 'Dashboard',
    icon: LayoutDashboard,
    permission: 'ops.live',
  },
  {
    id: 'verification',
    href: '/admin/drivers',
    label: 'Verification',
    icon: FileSearch,
    permission: 'kyc.read',
  },
  { id: 'ops', href: '/admin/ops', label: 'Live Ops', icon: Map, permission: 'ops.live' },
  {
    id: 'bookings',
    href: '/admin/bookings',
    label: 'Bookings',
    icon: Briefcase,
    permission: 'booking.read',
  },
  {
    id: 'disputes',
    href: '/admin/disputes',
    label: 'Disputes',
    icon: Scale,
    permission: 'dispute.handle',
  },
  { id: 'users', href: '/admin/users', label: 'Users', icon: Users, permission: 'user.read' },
  {
    id: 'drivers',
    href: '/admin/drivers/list',
    label: 'Drivers',
    icon: Car,
    permission: 'user.read',
  },
  {
    id: 'fleets',
    href: '/admin/fleets',
    label: 'Fleets',
    icon: ShieldCheck,
    permission: 'user.read',
  },
  {
    id: 'finance',
    href: '/admin/finance',
    label: 'Finance',
    icon: Wallet,
    permission: 'finance.read',
  },
  {
    id: 'pricing',
    href: '/admin/pricing',
    label: 'Pricing',
    icon: Tags,
    permission: 'pricing.edit',
  },
  {
    id: 'commission',
    href: '/admin/commission',
    label: 'Commission',
    icon: Percent,
    // W11: `commission.propose` rather than `commission.edit`, so Operations —
    // who propose and who cannot set a rate — can reach the screen to do it.
    permission: 'commission.propose',
  },
  {
    id: 'dispatch',
    href: '/admin/dispatch',
    label: 'Dispatch',
    icon: Compass,
    permission: 'dispatch.config',
  },
  { id: 'zones', href: '/admin/zones', label: 'Zones', icon: Gauge, permission: 'zone.edit' },
  {
    id: 'promotions',
    href: '/admin/promotions',
    label: 'Promotions',
    icon: Megaphone,
    permission: 'promo.manage',
  },
  {
    id: 'support',
    href: '/admin/support',
    label: 'Support',
    icon: LifeBuoy,
    permission: 'ticket.handle',
  },
  { id: 'sos', href: '/admin/sos', label: 'SOS', icon: ShieldAlert, permission: 'sos.handle' },
  {
    id: 'analytics',
    href: '/admin/analytics',
    label: 'Analytics',
    icon: BarChart3,
    permission: 'analytics.export',
  },
  {
    id: 'privacy',
    href: '/admin/privacy',
    label: 'Privacy',
    icon: ShieldCheck,
    permission: 'privacy.handle',
  },
  {
    id: 'admins',
    href: '/admin/admins',
    label: 'Admins',
    icon: CreditCard,
    permission: 'admin.manage',
  },
  { id: 'audit', href: '/admin/audit', label: 'Audit', icon: Bell, permission: 'audit.read' },
  // Self-service (2FA, sessions) — every admin, no permission gate.
  {
    id: 'settings',
    href: '/admin/settings/security',
    label: 'Settings',
    icon: Settings,
    permission: null,
  },
];

export function AdminSidebar({ badges }: { badges?: Record<string, number> }): React.ReactNode {
  const pathname = usePathname();
  const can = useAdminCan();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center px-5">
        <span className="font-display text-lg font-bold text-brand">Towing Admin</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Admin sections">
        {NAV_ITEMS.filter((item) => item.permission === null || can(item.permission)).map(
          ({ id, href, label, icon: Icon }) => {
            // `/admin` would match every page with a bare prefix test; the
            // dashboard is active only at the root.
            const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
            const badge = badges?.[id];
            return (
              <Link
                key={id}
                href={href}
                data-testid={`admin-nav-${id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-input px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand text-on-brand'
                    : 'text-text-secondary hover:bg-surface1 hover:text-text-primary',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {badge !== undefined && badge > 0 ? (
                  <span
                    data-testid={`admin-nav-badge-${id}`}
                    className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand"
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          },
        )}
      </nav>
    </aside>
  );
}

/** Exported for the Playwright shell spec, so the assertion list cannot drift. */
export const ADMIN_NAV_ITEM_IDS = NAV_ITEMS.map((item) => item.id);
