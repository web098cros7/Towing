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
import type { AnalyticsRevenueResponse } from '@towing/api-contracts';
import { KpiCard, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@towing/web-ui';

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const percent = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

/** §22.2 revenue: GMV, commission by band, effective take rate, AOV. */
export function RevenueTab({ data }: { data: AnalyticsRevenueResponse | undefined }) {
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
    gmv: Math.round(day.gmvPaise / 100),
    commission: Math.round(day.commissionPaise / 100),
    takeRate: day.takeRateBps / 100,
  }));

  // Band totals across the range — the §22.2 "commission revenue by band" line.
  const byBand = (['A', 'B', 'C'] as const).map((band) => {
    const rows = data.bands.filter((row) => row.band === band);
    return {
      band,
      bookings: rows.reduce((total, row) => total + row.bookingsPaid, 0),
      gmvPaise: rows.reduce((total, row) => total + row.gmvPaise, 0),
      commissionPaise: rows.reduce((total, row) => total + row.commissionPaise, 0),
      payoutPaise: rows.reduce((total, row) => total + row.driverPayoutPaise, 0),
    };
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="GMV" value={rupees(data.totals.gmvPaise)} />
        <KpiCard label="Commission" value={rupees(data.totals.commissionPaise)} />
        <KpiCard label="Take rate" value={percent(data.totals.takeRateBps)} hint="commission ÷ GMV" />
        <KpiCard label="AOV" value={rupees(data.totals.aovPaise)} hint="per paid booking" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">GMV vs commission (₹)</h3>
          <div className="h-64" data-testid="chart-revenue">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="gmv" name="GMV ₹" />
                <Bar dataKey="commission" name="Commission ₹" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Effective take rate (%)</h3>
          <div className="h-64" data-testid="chart-take-rate">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 30]} />
                <Tooltip />
                <Line type="monotone" dataKey="takeRate" name="Take %" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-card border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Commission by band</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Band</TableHead>
              <TableHead>Paid bookings</TableHead>
              <TableHead>GMV</TableHead>
              <TableHead>Commission</TableHead>
              <TableHead>Driver payout</TableHead>
              <TableHead>Take rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byBand.map((band) => (
              <TableRow key={band.band} data-testid={`band-${band.band}`}>
                <TableCell className="font-semibold">{band.band}</TableCell>
                <TableCell className="tabular-nums">{band.bookings}</TableCell>
                <TableCell className="tabular-nums">{rupees(band.gmvPaise)}</TableCell>
                <TableCell className="tabular-nums">{rupees(band.commissionPaise)}</TableCell>
                <TableCell className="tabular-nums">{rupees(band.payoutPaise)}</TableCell>
                <TableCell className="tabular-nums">
                  {band.gmvPaise > 0
                    ? percent(Math.round((band.commissionPaise / band.gmvPaise) * 10_000))
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
