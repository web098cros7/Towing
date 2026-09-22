'use client';

import { cn } from '../lib/cn';

export interface DateRange {
  /** Inclusive `YYYY-MM-DD`, or null for "unbounded". */
  from: string | null;
  to: string | null;
}

/**
 * Two native date inputs (W1 §3.3) — the guide's deliberate choice over a
 * calendar popover. Native inputs give locale formatting, keyboard entry and
 * mobile pickers for free, and an audit filter's day boundaries are better
 * typed than clicked. Values are DATE strings, not instants: the backend
 * expands them to IST day boundaries (§3.5), and converting to UTC here would
 * move a boundary by 5 h 30 m in the wrong direction.
 */
export function DateRangePicker({
  value,
  onChange,
  className,
  fromLabel = 'From',
  toLabel = 'To',
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <div className={cn('flex items-end gap-2', className)}>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {fromLabel}
        </span>
        <input
          type="date"
          value={value.from ?? ''}
          data-testid="date-range-from"
          onChange={(event) => onChange({ ...value, from: event.target.value || null })}
          className="h-10 rounded-input border border-border-strong bg-card px-2.5 text-sm text-text-primary focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/40"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {toLabel}
        </span>
        <input
          type="date"
          value={value.to ?? ''}
          data-testid="date-range-to"
          onChange={(event) => onChange({ ...value, to: event.target.value || null })}
          className="h-10 rounded-input border border-border-strong bg-card px-2.5 text-sm text-text-primary focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/40"
        />
      </label>
    </div>
  );
}
