'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatPaise } from '@/lib/money';
import type { EarningsTrendPoint } from '../types';

export function EarningsTrendChart({ data }: { data: EarningsTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--divider)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) =>
            new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
          }
          tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `₹${Math.round(v / 100_000)}k`}
          tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          formatter={(value) => [formatPaise(Number(value)), 'Fleet share']}
          labelFormatter={(d) =>
            new Date(String(d)).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
            })
          }
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text-primary)',
          }}
        />
        {/* `fleetSharePaise`, not gross: this is what the fleet actually keeps,
            and it is the number the wallet balance is built from. */}
        <Area
          type="monotone"
          dataKey="fleetSharePaise"
          stroke="var(--brand)"
          strokeWidth={2}
          fill="url(#netFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
