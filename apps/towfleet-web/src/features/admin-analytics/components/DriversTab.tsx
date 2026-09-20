'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsDriverResponse } from '@towing/api-contracts';
import { KpiCard, Skeleton } from '@towing/web-ui';

/** §22.2 driver: activity, ratings distribution, the fleet's current quality averages. */
export function DriversTab({ data }: { data: AnalyticsDriverResponse | undefined }) {
  if (!data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activity = data.days.map((day) => ({
    day: day.day.slice(5),
    activeDrivers: day.activeDrivers,
    newCustomers: day.newCustomers,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Driver days" value={String(data.totals.driverDays)} hint="summed per day" />
        <KpiCard
          label="Avg acceptance"
          value={
            data.currentAverages.acceptancePct === null
              ? '—'
              : `${data.currentAverages.acceptancePct}%`
          }
          hint="current snapshot"
        />
        <KpiCard
          label="Avg completion"
          value={
            data.currentAverages.completionPct === null
              ? '—'
              : `${data.currentAverages.completionPct}%`
          }
          hint="current snapshot"
        />
        <KpiCard
          label="Avg rating"
          value={data.currentAverages.averageRating === null ? '—' : String(data.currentAverages.averageRating)}
          hint="current snapshot"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Rating distribution</h3>
          <div className="h-64" data-testid="chart-ratings">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.ratings}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="rating" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" name="Reviews" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Active drivers & new customers</h3>
          <div className="h-64" data-testid="chart-driver-activity">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="activeDrivers" name="Active drivers" dot={false} />
                <Line type="monotone" dataKey="newCustomers" name="New customers" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
