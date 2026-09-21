'use client';

import { ChevronRight, LogOut, Menu, PanelLeft, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, cn } from '@towing/web-ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { RealtimeStatusChip } from '@/features/realtime/components/RealtimeStatusChip';
import { useFleetSettings } from '@/features/settings/api/settings.queries';

const SEGMENT_LABELS: Record<string, string> = {
  map: 'Live Map',
  trucks: 'Trucks',
  drivers: 'Drivers',
  jobs: 'Jobs',
  alerts: 'Alerts',
  earnings: 'Earnings',
  reports: 'Reports',
  settings: 'Settings',
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return [{ label: 'Dashboard', href: '/' }];
    const out: Array<{ label: string; href: string }> = [{ label: 'Dashboard', href: '/' }];
    let href = '';
    segments.forEach((segment) => {
      href += `/${segment}`;
      const isId = segment.length > 12 && segment.includes('-');
      out.push({
        label: isId ? 'Detail' : (SEGMENT_LABELS[segment] ?? segment),
        href,
      });
    });
    return out;
  }, [pathname]);

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
 * Fleet console topbar — breadcrumbs, ⌘K palette trigger, realtime chip and
 * an account menu (business name from settings, with a static fallback while
 * it loads). Opens the fleet palette via the `fleet:open-palette` event so
 * the topbar never owns palette state.
 */
export function Topbar({
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
  const { data: settings } = useFleetSettings();
  const [menuOpen, setMenuOpen] = useState(false);

  const openPalette = () => window.dispatchEvent(new CustomEvent('fleet:open-palette'));

  const logout = async () => {
    await fetch('/api/session', { method: 'DELETE' });
    router.replace('/login');
    router.refresh();
  };

  const fleetName = settings?.businessName?.trim() || 'Lakshmi Recovery Services';

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
          <span className="flex-1 truncate text-left">Search trucks, jobs…</span>
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

        <RealtimeStatusChip />

        <ThemeToggle />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="flex h-9 max-w-44 items-center gap-2 rounded-input border border-transparent px-2 transition-colors hover:border-border hover:bg-surface1"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-bold text-brand">
              {fleetName.charAt(0).toUpperCase()}
            </span>
            <span className="hidden truncate text-left text-sm text-text-secondary xl:block">
              {fleetName}
            </span>
          </button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                className="animate-admin-pop-in absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-card border border-border bg-card shadow-xl"
              >
                <div className="border-b border-border px-4 py-3">
                  <p className="truncate text-sm font-semibold">{fleetName}</p>
                  <p className="truncate text-xs text-text-secondary">Fleet owner</p>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-text-secondary hover:bg-surface1 hover:text-text-primary"
                >
                  <Settings className="size-4" /> Business settings
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
