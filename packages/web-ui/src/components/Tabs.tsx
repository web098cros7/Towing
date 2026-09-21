'use client';

import { cn } from '../lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Optional count rendered beside the label (e.g. a queue depth). */
  count?: number;
}

/**
 * Controlled tab strip (W1 §3.3). The PANELS stay with the caller: every
 * screen that needs tabs has different data-loading semantics per tab
 * (some keep both mounted, some unmount), and baking one choice in here is
 * how tab components start hiding refetch bugs.
 *
 * `role="tablist"` + `aria-selected` rather than an ARIA-free button row: the
 * KYC and finance filters already look like tabs, and a screen reader should
 * hear them as such.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-1 rounded-input bg-surface1 p-1', className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`tab-${item.value}`}
            onClick={() => onChange(item.value)}
            className={cn(
              'rounded-input px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-brand-tint text-brand' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="ml-1.5 tabular-nums opacity-80">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
