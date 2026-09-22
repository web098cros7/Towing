'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsSummaryResponse } from '@towing/api-contracts';
import { KpiCard, Skeleton } from '@towing/web-ui';

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const percent = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

/** The §22.2 marketplace headline: the numbers an operator quotes in a standup. */
export function SummaryTab({ data }: { data: AnalyticsSummaryResponse | undefined }) {
  if (!data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const chart = data.days.map((day) => ({
    day: day.day.slice(5),
    created: day.bookingsCreated,
    matched: day.bookingsMatched,
    gmvRupees: Math.round(day.gmvPaise / 100),
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="GMV" value={rupees(data.totals.gmvPaise)} hint="paid bookings" />
        <KpiCard
          label="Commission"
          value={rupees(data.totals.commissionPaise)}
          hint={percent(data.totals.takeRateBps) + ' take rate'}
        />
        <KpiCard label="Bookings" value={String(data.totals.bookingsCreated)} hint="created" />
        <KpiCard
          label="Fill rate"
          value={percent(data.totals.fillRateBps)}
          hint={`${data.totals.noDriversFound} no-drivers`}
        />
        <KpiCard
          label="Cancellation rate"
          value={percent(data.totals.cancellationRateBps)}
          hint={`${data.totals.bookingsPaid} paid`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Bookings created vs matched</h3>
          <div className="h-64" data-testid="chart-bookings">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="created" name="Created" dot={false} />
                <Line type="monotone" dataKey="matched" name="Matched" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">GMV per day (₹)</h3>
          <div className="h-64" data-testid="chart-gmv">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Area type="monotone" dataKey="gmvRupees" name="GMV ₹" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
