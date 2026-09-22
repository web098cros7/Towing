'use client';

import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsBandDay, AnalyticsDay } from '@towing/api-contracts';
import { Card } from '@towing/web-ui';
import { cn } from '@towing/web-ui';
import {
  formatAxisCount,
  formatAxisINR,
  formatDeltaPct,
  formatINR,
} from '../lib/dashboardRange';

/* Palette — fixed hex so charts read identically in light and dark mode. */
const GMV_STROKE = '#6366f1';
const COMMISSION_STROKE = '#a78bfa';
const CREATED_STROKE = '#6366f1';
const PAID_STROKE = '#c4b5fd';
const BAND_COLORS = ['#60a5fa', '#c084fc', '#f9a8d4'] as const;

const AXIS_TICK = { fill: 'var(--text-tertiary)', fontSize: 11 } as const;

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className,
  testId,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}): React.ReactNode {
  return (
    <Card className={cn('flex flex-col p-4 md:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  money: boolean;
}): React.ReactNode {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-card border border-border bg-card px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-semibold">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-1.5 text-xs tabular-nums">
          <span
            className="size-2 rounded-full"
            style={{ background: entry.color ?? GMV_STROKE }}
            aria-hidden
          />
          <span className="text-text-secondary">{entry.name}:</span>
          <span className="font-semibold">
            {money ? formatINR(Number(entry.value)) : Number(entry.value).toLocaleString('en-IN')}
          </span>
        </p>
      ))}
    </div>
  );
}

export interface RevenuePoint {
  label: string;
  gmv: number;
  commission: number;
}

export function toRevenuePoints(days: AnalyticsDay[]): RevenuePoint[] {
  return days.map((day) => ({
    label: day.day.slice(5),
    gmv: Math.round(day.gmvPaise / 100),
    commission: Math.round(day.commissionPaise / 100),
  }));
}

/** Revenue Overview — GMV + commission area chart with gradient fills. */
export function RevenueOverviewCard({
  points,
  totalGmv,
  deltaPct,
  caption,
}: {
  points: RevenuePoint[];
  totalGmv: number;
  deltaPct: number | null;
  caption: string;
}): React.ReactNode {
  const gid = useId().replace(/:/g, '');
  return (
    <ChartCard
      title="Revenue Overview"
      testId="chart-revenue-overview"
      subtitle="GMV and commission across the range"
      action={
        <LegendDots
          items={[
            { color: GMV_STROKE, label: 'GMV' },
            { color: COMMISSION_STROKE, label: 'Commission' },
          ]}
        />
      }
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <p className="text-3xl font-bold tabular-nums tracking-tight">{formatINR(totalGmv)}</p>
        {deltaPct !== null ? (
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
              deltaPct >= 0 ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
            )}
          >
            {formatDeltaPct(deltaPct)}
          </span>
        ) : null}
        <span className="text-xs text-text-tertiary">{caption}</span>
      </div>
      {points.length === 0 ? (
        <EmptyChart>Nothing in this range yet.</EmptyChart>
      ) : (
        <div className="h-80" data-testid="chart-revenue-overview">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`${gid}-gmv`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GMV_STROKE} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={GMV_STROKE} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${gid}-comm`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COMMISSION_STROKE} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COMMISSION_STROKE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} vertical={false} />
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
              <Tooltip content={<ChartTooltip money />} cursor={{ stroke: 'var(--border-strong)' }} />
              <Area
                type="monotone"
                dataKey="gmv"
                name="GMV"
                stroke={GMV_STROKE}
                strokeWidth={2.5}
                fill={`url(#${gid}-gmv)`}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="commission"
                name="Commission"
                stroke={COMMISSION_STROKE}
                strokeWidth={2}
                fill={`url(#${gid}-comm)`}
                dot={false}
                activeDot={{ r: 3.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export interface GrowthPoint {
  label: string;
  created: number;
  paid: number;
}

export function toGrowthPoints(days: AnalyticsDay[]): GrowthPoint[] {
  return days.map((day) => ({
    label: day.day.slice(5),
    created: day.bookingsCreated,
    paid: day.bookingsPaid,
  }));
}

/** Customer Growth — bookings created vs paid per day. */
export function BookingsGrowthCard({ points }: { points: GrowthPoint[] }): React.ReactNode {
  const gid = useId().replace(/:/g, '');
  return (
    <ChartCard
      title="Booking Growth"
      testId="chart-booking-growth"
      subtitle="Created vs paid bookings per day"
      action={
        <LegendDots
          items={[
            { color: CREATED_STROKE, label: 'Created' },
            { color: PAID_STROKE, label: 'Paid' },
          ]}
        />
      }
    >
      {points.length === 0 ? (
        <EmptyChart>Nothing in this range yet.</EmptyChart>
      ) : (
        <div className="h-64" data-testid="chart-booking-growth">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`${gid}-created`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CREATED_STROKE} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={CREATED_STROKE} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${gid}-paid`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PAID_STROKE} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={PAID_STROKE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} vertical={false} />
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
                tickFormatter={formatAxisCount}
                width={48}
              />
              <Tooltip content={<ChartTooltip money={false} />} cursor={{ stroke: 'var(--border-strong)' }} />
              <Area
                type="monotone"
                dataKey="created"
                name="Created"
                stroke={CREATED_STROKE}
                strokeWidth={2.5}
                fill={`url(#${gid}-created)`}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="paid"
                name="Paid"
                stroke={PAID_STROKE}
                strokeWidth={2}
                fill={`url(#${gid}-paid)`}
                dot={false}
                activeDot={{ r: 3.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export interface BandSlice {
  band: 'A' | 'B' | 'C';
  gmv: number;
  bookings: number;
}

export function toBandSlices(bands: AnalyticsBandDay[]): BandSlice[] {
  return (['A', 'B', 'C'] as const).map((band) => {
    const rows = bands.filter((row) => row.band === band);
    return {
      band,
      gmv: Math.round(rows.reduce((t, r) => t + r.gmvPaise, 0) / 100),
      bookings: rows.reduce((t, r) => t + r.bookingsPaid, 0),
    };
  });
}

/** Plan Mix — GMV share by distance band, donut with centered total. */
export function BandMixCard({
  slices,
  totalPaid,
}: {
  slices: BandSlice[];
  totalPaid: number;
}): React.ReactNode {
  const total = slices.reduce((t, s) => t + s.gmv, 0);
  return (
    <ChartCard title="Revenue Mix" subtitle="GMV share by distance band">
      {total === 0 ? (
        <EmptyChart>Nothing in this range yet.</EmptyChart>
      ) : (
        <>
          <div className="relative mx-auto h-52 w-full max-w-64" data-testid="chart-band-mix">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<ChartTooltip money />} />
                <Pie
                  data={slices}
                  dataKey="gmv"
                  nameKey="band"
                  innerRadius="68%"
                  outerRadius="92%"
                  paddingAngle={3}
                  cornerRadius={6}
                  strokeWidth={0}
                >
                  {slices.map((slice, i) => (
                    <Cell key={slice.band} fill={BAND_COLORS[i % BAND_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                {totalPaid.toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-text-secondary">paid bookings</p>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {slices.map((slice, i) => {
              const pct = total > 0 ? (slice.gmv / total) * 100 : 0;
              return (
                <li key={slice.band} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: BAND_COLORS[i % BAND_COLORS.length] }}
                    aria-hidden
                  />
                  <span className="font-medium">Band {slice.band}</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {formatINR(slice.gmv)}
                  </span>
                  <span className="w-12 text-right text-xs text-text-secondary tabular-nums">
                    {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ChartCard>
  );
}

function LegendDots({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="size-2 rounded-full" style={{ background: item.color }} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-input bg-surface1/50 text-sm text-text-tertiary">
      {children}
    </div>
  );
}
