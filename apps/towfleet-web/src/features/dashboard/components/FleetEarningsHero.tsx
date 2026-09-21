'use client';

import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, ErrorState, Skeleton, cn } from '@towing/web-ui';
import { useEarningsSummary } from '@/features/earnings/api/earnings.queries';
import type { DateRange } from '@/features/earnings/types';
import { formatPaise } from '@/lib/money';
import {
  formatAxisINR,
  formatDeltaPct,
  periodDelta,
} from '@/features/admin-ops/lib/dashboardRange';

const FLEET_STROKE = '#6366f1';
const GROSS_STROKE = '#c4b5fd';
const AXIS_TICK = { fill: 'var(--text-tertiary)', fontSize: 11 } as const;

interface FleetTooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function FleetTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: FleetTooltipEntry[];
  label?: string;
}): React.ReactNode {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-card border border-border bg-card px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-semibold">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-1.5 text-xs tabular-nums">
          <span
            className="size-2 rounded-full"
            style={{ background: entry.color ?? FLEET_STROKE }}
            aria-hidden
          />
          <span className="text-text-secondary">{entry.name}:</span>
          <span className="font-semibold">
            {formatPaise(Math.round(Number(entry.value) * 100))}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * Fleet dashboard hero — fleet-share + gross area chart over a trailing
 * range, with an honest second-half-vs-first-half delta pill. Same visual
 * language as the admin Revenue Overview; data comes from the fleet
 * `earnings_daily` projection through `useEarningsSummary(range)`.
 */
export function FleetEarningsHero({ range, rangeLabel }: { range: DateRange; rangeLabel: string }) {
  const gid = useId().replace(/:/g, '');
  const summary = useEarningsSummary(range);

  const points = useMemo(
    () =>
      (summary.data?.trend ?? []).map((d) => ({
        label: d.date.slice(5),
        full: d.date,
        fleet: Math.round(d.fleetSharePaise / 100),
        gross: Math.round(d.grossPaise / 100),
      })),
    [summary.data],
  );
  const delta = periodDelta(points.map((p) => p.fleet));

  return (
    <Card className="flex h-full flex-col p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Earnings Overview</h3>
          <p className="mt-0.5 text-xs text-text-secondary">Fleet share and gross · {rangeLabel}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: FLEET_STROKE }} aria-hidden />
            Fleet share
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: GROSS_STROKE }} aria-hidden />
            Gross
          </span>
        </div>
      </div>

      {summary.isError ? (
        <ErrorState onRetry={() => void summary.refetch()} />
      ) : summary.isLoading || !summary.data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <p className="text-3xl font-bold tabular-nums tracking-tight">
              {formatPaise(summary.data.totals.fleetSharePaise)}
            </p>
            {delta.pct !== null ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                  delta.pct >= 0 ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
                )}
              >
                {formatDeltaPct(delta.pct)}
              </span>
            ) : null}
            <span className="text-xs text-text-tertiary">
              {delta.halfDays > 0 ? `vs prior ${delta.halfDays}d` : 'vs prior period'}
            </span>
          </div>
          {points.length === 0 ? (
            <div className="flex h-72 items-center justify-center rounded-input bg-surface1/50 text-sm text-text-tertiary">
              No settled earnings in this range yet.
            </div>
          ) : (
            <div className="h-72" data-testid="chart-fleet-earnings">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`${gid}-fleet`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={FLEET_STROKE} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={FLEET_STROKE} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`${gid}-gross`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GROSS_STROKE} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={GROSS_STROKE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    opacity={0.6}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                    dy={6}
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={formatAxisINR}
                    width={56}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--border-strong)' }}
                    content={<FleetTooltip />}
                  />
                  <Area
                    type="monotone"
                    dataKey="fleet"
                    name="Fleet share"
                    stroke={FLEET_STROKE}
                    strokeWidth={2.5}
                    fill={`url(#${gid}-fleet)`}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="gross"
                    name="Gross"
                    stroke={GROSS_STROKE}
                    strokeWidth={2}
                    fill={`url(#${gid}-gross)`}
                    dot={false}
                    activeDot={{ r: 3.5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
