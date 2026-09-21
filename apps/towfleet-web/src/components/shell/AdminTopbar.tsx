'use client';

import { ChevronRight, LogOut, Menu, PanelLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, cn } from '@towing/web-ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { useAdminRealtime } from '@/features/admin-realtime/AdminRealtimeProvider';
import { env } from '@/lib/env';

const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Home',
  drivers: 'Drivers',
  list: 'Directory',
  users: 'Users',
  fleets: 'Fleets',
  bookings: 'Bookings',
  disputes: 'Disputes',
  finance: 'Finance',
  pricing: 'Pricing',
  commission: 'Commission',
  dispatch: 'Dispatch',
  zones: 'Zones',
  ops: 'Live Ops',
  promotions: 'Promotions',
  quotes: 'Quotes',
  support: 'Support',
  sos: 'SOS',
  content: 'Content',
  analytics: 'Analytics',
  privacy: 'Privacy',
  admins: 'Admins',
  audit: 'Audit',
  settings: 'Settings',
  security: 'Security',
  notifications: 'Notifications',
  'app-view': 'App view',
};

const MODE_STYLE: Record<string, string> = {
  live: 'bg-success',
  mock: 'bg-info',
  polling: 'bg-warning',
  connecting: 'bg-warning',
  reconnecting: 'bg-warning',
  offline: 'bg-error',
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    // Drop the leading `admin`; the root crumbs to Dashboard.
    const rest = segments[0] === 'admin' ? segments.slice(1) : segments;
    const out: Array<{ label: string; href: string }> = [{ label: 'Home', href: '/admin' }];
    let href = '/admin';
    rest.forEach((segment, i) => {
      href += `/${segment}`;
      const isId = segment.length > 12 && segment.includes('-');
      if (isId) {
        out.push({ label: 'Detail', href });
        return;
      }
      const label =
        SEGMENT_LABELS[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
      // Last crumb is current page — still linkable except when it's an id.
      out.push({ label, href });
      void i;
    });
    return out.length > 1 ? out : [];
  }, [pathname]);

  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 md:flex">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${crumb.href}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" /> : null}
            {last ? (
              <span aria-current="page" className="truncate text-sm font-medium text-text-primary">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate text-sm text-text-secondary hover:text-text-primary hover:underline"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * The console's topbar — Modern SaaS refresh.
 *
 * What stays: brand, the signed-in identity, the theme toggle and logout.
 * What lands: breadcrumbs, a ⌘K palette trigger, a realtime honesty dot
 * (§11.6) and a mock-mode badge, plus sidebar collapse / mobile menu.
 * The palette itself opens via the `admin:open-palette` window event so the
 * topbar never owns palette state.
 */
export function AdminTopbar({
  collapsed,
  onToggleCollapse,
  onOpenMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMobile: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { admin } = useAdminIdentity();
  const { mode } = useAdminRealtime();
  const [menuOpen, setMenuOpen] = useState(false);

  const openPalette = () => window.dispatchEvent(new CustomEvent('admin:open-palette'));

  const logout = async () => {
    await fetch('/api/admin-session', { method: 'DELETE' });
    // M0-F2: clear the whole query cache — identity AND queue rows. Without
    // this the next admin in the same tab sees the previous admin's identity
    // and cached rows (driver PII, bank data).
    queryClient.clear();
    router.replace('/admin/login');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card/90 px-3 backdrop-blur md:px-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenMobile}
        aria-label="Open navigation"
        className="lg:hidden"
      >
        <Menu className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden lg:inline-flex"
      >
        <PanelLeft className="size-4" />
      </Button>

      <Breadcrumbs pathname={pathname} />

      <div className="flex flex-1 items-center justify-end gap-2">
        <button
          type="button"
          onClick={openPalette}
          aria-label="Search and jump (Command K)"
          className={cn(
            'hidden h-9 items-center gap-2 rounded-input border border-border bg-surface0 px-3 text-sm text-text-tertiary',
            'transition-colors hover:border-border-strong hover:text-text-secondary sm:flex sm:w-56 lg:w-72',
          )}
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search bookings, people…</span>
          <kbd className="rounded border border-border-strong bg-card px-1.5 font-mono text-[10px] text-text-secondary">
            ⌘K
          </kbd>
        </button>
        <button
          type="button"
          onClick={openPalette}
          aria-label="Search and jump"
          className="flex h-9 w-9 items-center justify-center rounded-input border border-border text-text-secondary sm:hidden"
        >
          <Search className="size-4" />
        </button>

        {env.useMocks ? (
          <span
            title="Mock data — set NEXT_PUBLIC_USE_MOCKS=false for the real backend"
            className="hidden rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning sm:inline"
          >
            MOCK
          </span>
        ) : null}

        <span
          title={mode === 'live' ? 'Realtime connected' : `Realtime: ${mode} — REST fallback active`}
          className="hidden items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[11px] font-medium text-text-secondary sm:flex"
        >
          <span className={cn('size-1.5 rounded-full', MODE_STYLE[mode] ?? 'bg-warning')} />
          {mode === 'live' ? 'Live' : mode}
        </span>

        <ThemeToggle />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="flex h-9 items-center gap-2 rounded-input border border-transparent px-2 transition-colors hover:border-border hover:bg-surface1"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-tint text-xs font-bold text-brand">
              {admin ? admin.name.charAt(0).toUpperCase() : '?'}
            </span>
            {admin ? (
              <span
                className="hidden max-w-32 truncate text-left text-sm text-text-secondary xl:block"
                data-testid="admin-identity"
              >
                {admin.name}
              </span>
            ) : null}
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                className="animate-admin-pop-in absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-card border border-border bg-card shadow-xl"
              >
                <div className="border-b border-border px-4 py-3">
                  <p className="truncate text-sm font-semibold">{admin?.name ?? 'Admin'}</p>
                  <p className="truncate text-xs capitalize text-text-secondary">
                    {admin?.subRole.replace(/_/g, ' ') ?? '—'}
                  </p>
                </div>
                <Link
                  href="/admin/settings/security"
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                  className="block px-4 py-2.5 text-sm text-text-secondary hover:bg-surface1 hover:text-text-primary"
                >
                  Security settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={logout}
                  aria-label="Log out"
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-error hover:bg-surface1"
                >
                  <LogOut className="size-4" /> Log out
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
