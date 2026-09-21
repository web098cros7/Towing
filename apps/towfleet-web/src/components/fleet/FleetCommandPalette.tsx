'use client';

import { ArrowRight, BookOpen, Briefcase, FileSearch, Loader2, Search, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@towing/web-ui';
import { FLEET_NAV_COMMANDS } from '@/components/shell/SidebarNav';
import { jobsDataSource } from '@/features/jobs/api/jobsDataSource';
import { trucksDataSource } from '@/features/trucks/api/trucksDataSource';

interface PaletteEntry {
  key: string;
  kind: 'nav' | 'truck' | 'job';
  title: string;
  subtitle: string;
  href: string;
}

const KIND_ICON = {
  nav: FileSearch,
  truck: Truck,
  job: Briefcase,
} as const;

/**
 * Fleet ⌘K palette — sections + trucks (plate) + jobs (code).
 *
 * Fleet lists are small (trucks ≤ 100, jobs first 50), so both are fetched
 * once per open and filtered client-side — no debounced server round trips.
 * Entity hits deep-link into the list search (`?q=`), which the trucks and
 * jobs pages honour as their initial filter.
 */
export function FleetCommandPalette(): React.ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [entities, setEntities] = useState<PaletteEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener('fleet:open-palette', openHandler);
    // Separate realm layout from the admin console, which owns its own
    // palette — no double-handling possible outside HMR overlap.
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', keyHandler);
    return () => {
      window.removeEventListener('fleet:open-palette', openHandler);
      window.removeEventListener('keydown', keyHandler);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setEntities([]);
    setActive(0);
    let cancelled = false;
    setLoading(true);
    Promise.all([
      trucksDataSource.list().catch(() => []),
      jobsDataSource.list({}).catch(() => []),
    ])
      .then(([trucks, jobs]) => {
        if (cancelled) return;
        const out: PaletteEntry[] = [
          ...trucks.map((t) => ({
            key: `truck-${t.id}`,
            kind: 'truck' as const,
            title: t.plate,
            subtitle: `Truck · ${t.assignedDriverName ?? 'Unassigned'}`,
            href: `/trucks?q=${encodeURIComponent(t.plate)}`,
          })),
          ...jobs.map((j) => ({
            key: `job-${j.id}`,
            kind: 'job' as const,
            title: j.code,
            subtitle: `Job · ${j.status.replace(/_/g, ' ')}`,
            href: `/jobs?q=${encodeURIComponent(j.code)}`,
          })),
        ];
        setEntities(out);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open ]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nav = FLEET_NAV_COMMANDS.filter((item) => item.label.toLowerCase().includes(q)).map(
      (item) => ({
        key: `nav-${item.href}`,
        kind: 'nav' as const,
        title: item.label,
        subtitle: 'Go to section',
        href: item.href,
      }),
    );
    if (!q) return [...nav.slice(0, 9)];
    const hits = entities
      .filter(
        (e) =>
          e.title.toLowerCase().includes(q) || e.subtitle.toLowerCase().includes(q),
      )
      .slice(0, 12);
    return [...nav.slice(0, 5), ...hits].slice(0, 17);
  }, [query, entities]);

  useEffect(() => {
    setActive(0);
  }, [query]);

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

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Fleet command palette"
    >
      <div
        className="animate-admin-fade-in absolute inset-0 bg-black/30"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      {/* `relative` so the panel stacks above the absolute scrim. */}
      <div className="relative flex justify-center px-4 pt-[12vh]">
        <div className="animate-admin-pop-in w-full max-w-xl overflow-hidden rounded-sheet border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-text-tertiary" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Jump to a section, truck plate, job code…"
              aria-label="Search fleet console"
              className="h-12 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            {loading ? (
              <Loader2 className="size-4 animate-spin text-text-tertiary" aria-label="Loading" />
            ) : (
              <kbd className="rounded border border-border bg-surface1 px-1.5 font-mono text-[10px] text-text-tertiary">
                esc
              </kbd>
            )}
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
            {results.length === 0 && !loading ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BookOpen className="size-6 text-text-tertiary" />
                <p className="text-sm font-medium">No matches</p>
                <p className="text-xs text-text-secondary">
                  Try a section name, truck plate or job code.
                </p>
              </div>
            ) : (
              results.map((entry) => {
                const Icon = KIND_ICON[entry.kind];
                const isActive = results[active]?.key === entry.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActiveByKey(entry.key)}
                    onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest' })}
                    onClick={() => go(entry)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-input px-3 py-2 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-brand-tint text-text-primary'
                        : 'text-text-secondary hover:bg-surface1',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-input',
                        isActive ? 'bg-brand/10 text-brand' : 'bg-surface1 text-text-tertiary',
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text-primary">
                        {entry.title}
                      </span>
                      <span className="block truncate text-xs text-text-secondary">
                        {entry.subtitle}
                      </span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-text-tertiary" />
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-border bg-surface1/50 px-4 py-2 text-[11px] text-text-tertiary">
            <span>
              <kbd className="rounded border border-border bg-card px-1 font-mono">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border border-border bg-card px-1 font-mono">↵</kbd> open
            </span>
            <span className="ml-auto hidden sm:inline">Sections + trucks + jobs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
