'use client';

import {
  Bar,
  BarChart,
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

const percent = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

/**
 * §22.2 marketplace: fill rate, time-to-match, active drivers vs demand.
 *
 * The three series share an x-axis but not a unit — percentages, seconds and
 * head-counts live on separate cards rather than one twin-axis chart, because
 * an operator reading a dual axis at 2 a.m. reads the wrong one.
 */
export function MarketplaceTab({ data }: { data: AnalyticsSummaryResponse | undefined }) {
  if (!data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const chart = data.days.map((day) => ({
    day: day.day.slice(5),
    fill: day.fillRateBps / 100,
    ttm50: day.ttmP50Seconds,
    ttm90: day.ttmP90Seconds,
    activeDrivers: day.activeDrivers,
  }));

  const empty = data.days.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Fill rate" value={percent(data.totals.fillRateBps)} hint="matched ÷ created" />
        <KpiCard
          label="Cancellations"
          value={String(data.totals.bookingsCancelled)}
          hint={percent(data.totals.cancellationRateBps)}
        />
        <KpiCard label="No drivers" value={String(data.totals.noDriversFound)} hint="searches that expired" />
        <KpiCard label="Driver days" value={String(data.totals.driverDays)} hint="summed per day" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Fill rate (%)</h3>
          <div className="h-64" data-testid="chart-fill">
            {empty ? (
              <p className="text-sm text-text-secondary">No days in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" fontSize={11} />
                  <YAxis fontSize={11} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="fill" name="Fill %" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Time to match (seconds)</h3>
          <div className="h-64" data-testid="chart-ttm">
            {empty ? (
              <p className="text-sm text-text-secondary">No days in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="ttm50" name="p50" dot={false} />
                  <Line type="monotone" dataKey="ttm90" name="p90" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-card border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Active drivers per day</h3>
        <div className="h-56" data-testid="chart-active-drivers">
          {empty ? (
            <p className="text-sm text-text-secondary">No days in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="activeDrivers" name="Drivers" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
