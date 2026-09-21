/**
 * Dashboard v2 range + delta helpers (NextAdmin-grade trends, honest numbers).
 *
 * Ranges are IST calendar days ending today — the same grain the analytics
 * rollup writes, so the dashboard never disagrees with `/admin/analytics`.
 * Deltas compare the range's second half against its first half ("vs prior
 * N days"), computed client-side from the same `days[]` the charts render,
 * so the pill and the curve can never tell different stories.
 */

export const DASHBOARD_RANGES = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
] as const;

/** Today's date in IST, `YYYY-MM-DD`. */
export function istToday(): string {
  return new Date(Date.now() + (new Date().getTimezoneOffset() + 330) * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Shift an IST `YYYY-MM-DD` string by whole days. */
export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function rangeFor(days: number): { from: string; to: string } {
  const to = istToday();
  return { from: addDays(to, -(days - 1)), to };
}

export interface PeriodDelta {
  current: number;
  previous: number;
  /** Percent change, second half vs first half. Null when uncomputable. */
  pct: number | null;
  /** Size of each compared half, for the "vs prior N days" caption. */
  halfDays: number;
}

/** Split a chronological series in half and compare the sums. */
export function periodDelta(values: number[]): PeriodDelta {
  const half = Math.floor(values.length / 2);
  if (half < 1) return { current: 0, previous: 0, pct: null, halfDays: 0 };
  const previous = values.slice(0, half).reduce((a, b) => a + b, 0);
  const current = values.slice(half).reduce((a, b) => a + b, 0);
  if (previous === 0) return { current, previous, pct: null, halfDays: half };
  return { current, previous, pct: ((current - previous) / previous) * 100, halfDays: half };
}

/** Full rupees, Indian grouping: `₹84,500`. */
export function formatINR(rupees: number): string {
  return `₹${Math.round(rupees).toLocaleString('en-IN')}`;
}

/** Paise → full rupees. */
export function formatPaiseINR(paise: number): string {
  return formatINR(paise / 100);
}

/** Compact axis rupees: `₹84.5K`, `₹1.2M`. */
export function formatAxisINR(rupees: number): string {
  const abs = Math.abs(rupees);
  if (abs >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${Math.round(rupees)}`;
}

/** Compact counts: `12.5K`. */
export function formatAxisCount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** `+15.2%` / `-0.6%` for delta pills. */
export function formatDeltaPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
