'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3m ago" with an absolute timestamp in `title` (W1 §3.3).
 *
 * Re-renders on a timer so a page left open does not claim an event happened
 * "just now" an hour later; the interval is 30 s because the coarsest label
 * this prints is minutes. Anything older than a week shows a date — "8d ago"
 * is harder to place than "14 Sep".
 */
export function RelativeTime({
  at,
  className,
}: {
  at: string | Date | null | undefined;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!at) return <span className={cn('text-text-tertiary', className)}>—</span>;

  const instant = typeof at === 'string' ? Date.parse(at) : at.getTime();
  if (Number.isNaN(instant)) {
    return <span className={cn('text-text-tertiary', className)}>—</span>;
  }

  return (
    <time
      dateTime={new Date(instant).toISOString()}
      title={new Date(instant).toLocaleString('en-IN')}
      className={cn('tabular-nums', className)}
    >
      {formatRelative(instant, now)}
    </time>
  );
}

export function formatRelative(instant: number, now: number): string {
  const elapsed = now - instant;
  if (elapsed < 0) return 'just now';
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(instant).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
