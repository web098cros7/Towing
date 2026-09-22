'use client';

import { ArrowRight, BookOpen, Briefcase, Car, FileSearch, Loader2, Search, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@towing/web-ui';
import { useAdminCan } from '@/components/admin/Can';
import { ADMIN_NAV_COMMANDS } from '@/components/shell/AdminSidebar';
import { adminBookingsDataSource } from '@/features/admin-bookings/api/adminBookingsDataSource';
import { adminDirectoryDataSource } from '@/features/admin-directory/api/adminDirectoryDataSource';

interface PaletteEntry {
  key: string;
  kind: 'nav' | 'booking' | 'driver' | 'user';
  title: string;
  subtitle: string;
  href: string;
  icon: 'nav' | 'booking' | 'driver' | 'user';
}

const KIND_ICON = {
  nav: FileSearch,
  booking: Briefcase,
  driver: Car,
  user: Users,
} as const;

/**
 * Global command palette (⌘K) — navigation + bookings/drivers/users search.
 *
 * Opens via the `admin:open-palette` window event (fired by the topbar) or
 * Cmd/Ctrl+K. Navigation entries reuse ADMIN_NAV_COMMANDS so they can never
 * drift from the sidebar; entity search reuses the same data sources the
 * pages read, so mocks and the real backend behave identically.
 */
export function CommandPalette(): React.ReactNode {
  const router = useRouter();
  const can = useAdminCan();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [entities, setEntities] = useState<PaletteEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener('admin:open-palette', openHandler);
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', keyHandler);
    return () => {
      window.removeEventListener('admin:open-palette', openHandler);
      window.removeEventListener('keydown', keyHandler);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setEntities([]);
      setActive(0);
      // Focus after the pop-in mounts.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open ]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const navEntries = useMemo<PaletteEntry[]>(() => {
    const q = query.trim().toLowerCase();
    return ADMIN_NAV_COMMANDS.filter((item) => {
      const perm = item.permission;
      return perm === null || can(perm);
    })
      .filter((item) => !q || item.label.toLowerCase().includes(q))
      .slice(0, q ? 8 : 10)
      .map((item) => ({
        key: `nav-${item.id}`,
        kind: 'nav',
        title: item.label,
        subtitle: `Go to ${item.group}`,
        href: item.href,
        icon: 'nav',
      }));
  }, [query, can]);

  const searchEntities = useCallback(async (q: string, signal: AbortSignal) => {
    if (q.length < 2) {
      setEntities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [bookings, drivers, users] = await Promise.all([
        adminBookingsDataSource.list({ page: 1, limit: 5, q }).catch(() => null),
        adminDirectoryDataSource.drivers({ q, page: 1, limit: 5 }).catch(() => null),
        adminDirectoryDataSource.users({ q, page: 1, limit: 5 }).catch(() => null),
      ]);
      if (signal.aborted) return;
      const out: PaletteEntry[] = [];
      for (const b of (bookings?.items ?? []) as Array<{
        id: string;
        code: string;
        status: string;
        userName?: string | null;
      }>) {
        out.push({
          key: `booking-${b.id}`,
          kind: 'booking',
          title: `${b.code} · ${b.status.replace(/_/g, ' ')}`,
          subtitle: b.userName ? `Booking · ${b.userName}` : 'Booking',
          href: `/admin/bookings/${b.id}`,
          icon: 'booking',
        });
      }
      for (const d of (drivers?.items ?? []) as Array<{
        id: string;
        name?: string | null;
        mobile: string;
        kycStatus: string;
      }>) {
        out.push({
          key: `driver-${d.id}`,
          kind: 'driver',
          title: d.name ?? d.mobile,
          subtitle: `Driver · ${d.mobile} · ${d.kycStatus}`,
          href: `/admin/drivers/list/${d.id}`,
          icon: 'driver',
        });
      }
      for (const u of (users?.items ?? []) as Array<{
        id: string;
        name?: string | null;
        mobile: string;
        status: string;
      }>) {
        out.push({
          key: `user-${u.id}`,
          kind: 'user',
          title: u.name ?? u.mobile,
          subtitle: `Customer · ${u.mobile} · ${u.status}`,
          href: `/admin/users/${u.id}`,
          icon: 'user',
        });
      }
      setEntities(out.slice(0, 15));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void searchEntities(debounced, controller.signal);
    return () => controller.abort();
  }, [debounced, searchEntities]);

  const results = useMemo(() => {
    // Navigation first, then entity hits.
    const merged = [...navEntries, ...entities];
    // De-dupe by key, cap for keyboard sanity.
    return merged.slice(0, 20);
  }, [navEntries, entities]);

  useEffect(() => {
    setActive(0);
  }, [query, entities.length]);

  const go = useCallback(
    (entry: PaletteEntry) => {
      setOpen(false);
      router.push(entry.href);
    },
    [router],
  );

  const setActiveByKey = useCallback(
    (key: string) => {
      const idx = results.findIndex((entry) => entry.key === key);
      if (idx >= 0) setActive(idx);
    },
    [results],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      go(results[active]!);
    }
  };

  if (!open) return null;

  const showEntities = debounced.length >= 2;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Command palette">
      <div
        className="animate-admin-fade-in absolute inset-0 bg-black/30"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      {/* `relative` so the panel stacks above the absolute backdrop scrim. */}
      <div className="relative flex justify-center px-4 pt-[12vh]">
        <div className="animate-admin-pop-in w-full max-w-xl overflow-hidden rounded-sheet border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-text-tertiary" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Jump to a section, booking, driver, customer…"
              aria-label="Search admin console"
              className="h-12 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            {loading ? (
              <Loader2 className="size-4 animate-spin text-text-tertiary" aria-label="Searching" />
            ) : (
              <kbd className="rounded border border-border bg-surface1 px-1.5 font-mono text-[10px] text-text-tertiary">
                esc
              </kbd>
            )}
          </div>
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
            {results.length === 0 && !loading ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BookOpen className="size-6 text-text-tertiary" />
                <p className="text-sm font-medium">No matches</p>
                <p className="text-xs text-text-secondary">
                  {showEntities
                    ? 'Try a booking code, name or mobile number.'
                    : 'Type to search sections — 2+ characters also searches bookings and people.'}
                </p>
              </div>
            ) : (
              <>
                {navEntries.length > 0 ? (
                  <PaletteGroup label="Sections">
                    {navEntries.map((entry) => (
                      <PaletteRow
                        key={entry.key}
                        entry={entry}
                        active={results[active]?.key === entry.key}
                        onHover={() => setActiveByKey(entry.key)}
                        onSelect={() => go(entry)}
                      />
                    ))}
                  </PaletteGroup>
                ) : null}
                {showEntities && entities.length > 0 ? (
                  <PaletteGroup label="Bookings & people">
                    {entities.map((entry) => (
                      <PaletteRow
                        key={entry.key}
                        entry={entry}
                        active={results[active]?.key === entry.key}
                        onHover={() => setActiveByKey(entry.key)}
                        onSelect={() => go(entry)}
                      />
                    ))}
                  </PaletteGroup>
                ) : null}
                {showEntities && loading && entities.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-text-secondary">
                    <Loader2 className="size-3.5 animate-spin" /> Searching bookings and people…
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-border bg-surface1/50 px-4 py-2 text-[11px] text-text-tertiary">
            <span>
              <kbd className="rounded border border-border bg-card px-1 font-mono">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border border-border bg-card px-1 font-mono">↵</kbd> open
            </span>
            <span className="ml-auto hidden sm:inline">Sections + bookings + drivers + customers</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaletteGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
        {label}
      </p>
      {children}
    </div>
  );
}

function PaletteRow({
  entry,
  active,
  onHover,
  onSelect,
}: {
  entry: PaletteEntry;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const Icon = KIND_ICON[entry.icon];
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest' })}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-input px-3 py-2 text-left text-sm transition-colors',
        active ? 'bg-brand-tint text-text-primary' : 'text-text-secondary hover:bg-surface1',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-input',
          active ? 'bg-brand/10 text-brand' : 'bg-surface1 text-text-tertiary',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-primary">{entry.title}</span>
        <span className="block truncate text-xs text-text-secondary">{entry.subtitle}</span>
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-text-tertiary" />
    </button>
  );
}
