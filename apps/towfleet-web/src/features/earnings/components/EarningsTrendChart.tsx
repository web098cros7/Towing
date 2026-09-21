'use client';

import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPaise } from '@/lib/money';
import type { EarningsTrendPoint } from '../types';

const FLEET_STROKE = '#6366f1';
const GROSS_STROKE = '#c4b5fd';

interface EarningsTooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function EarningsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: EarningsTooltipEntry[];
  label?: string;
}): React.ReactNode {
  if (!active || !payload || payload.length === 0) return null;
  const full = new Date(String(label)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
  });
  return (
    <div className="rounded-card border border-border bg-card px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-semibold">{full}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-1.5 text-xs tabular-nums">
          <span
            className="size-2 rounded-full"
            style={{ background: entry.color ?? FLEET_STROKE }}
            aria-hidden
          />
          <span className="text-text-secondary">{entry.name}:</span>
          <span className="font-semibold">{formatPaise(Number(entry.value))}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Fleet-share + gross area chart. Gross rides along as context; the fleet
 * share is the number the wallet balance is built from, so it leads.
 */
export function EarningsTrendChart({
  data,
  height = 240,
}: {
  data: EarningsTrendPoint[];
  height?: number;
}) {
  const gid = useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id={`${gid}-fleet`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={FLEET_STROKE} stopOpacity={0.28} />
            <stop offset="100%" stopColor={FLEET_STROKE} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${gid}-gross`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GROSS_STROKE} stopOpacity={0.2} />
            <stop offset="100%" stopColor={GROSS_STROKE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" opacity={0.6} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) =>
            new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
          }
          tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v: number) => `₹${Math.round(v / 100_000)}k`}
          tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip cursor={{ stroke: 'var(--border-strong)' }} content={<EarningsTooltip />} />
        <Area
          type="monotone"
          dataKey="fleetSharePaise"
          name="Fleet share"
          stroke={FLEET_STROKE}
          strokeWidth={2.5}
          fill={`url(#${gid}-fleet)`}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Area
          type="monotone"
          dataKey="grossPaise"
          name="Gross"
          stroke={GROSS_STROKE}
          strokeWidth={2}
          fill={`url(#${gid}-gross)`}
          dot={false}
          activeDot={{ r: 3.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
