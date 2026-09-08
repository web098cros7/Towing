'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  buttonVariants,
  cn,
  type ColumnDef,
} from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useReport } from '@/features/reports/api/reports.queries';
import { reportsExportUrl } from '@/features/reports/api/reportsDataSource';
import {
  GROUP_LABELS,
  PERIOD_LABELS,
  istDate,
  resolvePreset,
  type DriverReportRow,
  type PeriodReportRow,
  type PeriodPreset,
  type ReportGranularity,
  type ReportGroupBy,
  type ReportQuery,
  type TruckReportRow,
} from '@/features/reports/types';
import { env } from '@/lib/env';
import { formatPaise } from '@/lib/money';

const GROUPS: ReportGroupBy[] = ['truck', 'driver', 'period'];
const PRESETS: PeriodPreset[] = ['last7', 'last30', 'quarter', 'custom'];

const money = (paise: number) => <span className="tabular-nums">{formatPaise(paise)}</span>;

const truckColumns: ColumnDef<TruckReportRow, unknown>[] = [
  { accessorKey: 'plate', header: 'Truck' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'jobs', header: 'Jobs' },
  {
    id: 'utilization',
    // A PERIOD metric — share of in-service days with at least one job. Not the
    // dashboard's instantaneous utilisation; the header says so.
    header: 'Utilization (days)',
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.utilizationPct}%
        <span className="ml-1 text-xs text-text-tertiary">
          ({row.original.activeDays}/{row.original.inServiceDays})
        </span>
      </span>
    ),
  },
  { id: 'gross', header: 'Gross', cell: ({ row }) => money(row.original.grossPaise) },
  { id: 'fleetShare', header: 'Fleet share', cell: ({ row }) => money(row.original.fleetSharePaise) },
  {
    id: 'compliance',
    header: 'Compliance',
    cell: ({ row }) =>
      row.original.complianceExpiredCount > 0 ? (
        <span className="text-error">{row.original.complianceExpiredCount} expired</span>
      ) : row.original.complianceExpiringCount > 0 ? (
        <span className="text-warning-soft-fg">{row.original.complianceExpiringCount} expiring</span>
      ) : (
        <span className="text-text-tertiary">OK</span>
      ),
  },
];

const driverColumns: ColumnDef<DriverReportRow, unknown>[] = [
  { accessorKey: 'name', header: 'Driver' },
  { accessorKey: 'jobs', header: 'Jobs' },
  { id: 'gross', header: 'Gross', cell: ({ row }) => money(row.original.grossPaise) },
  {
    id: 'driverShare',
    header: 'Driver share',
    cell: ({ row }) => money(row.original.driverSharePaise),
  },
  { id: 'fleetShare', header: 'Fleet share', cell: ({ row }) => money(row.original.fleetSharePaise) },
  {
    id: 'rating',
    header: 'Rating',
    cell: ({ row }) => (row.original.ratingAvg === null ? '—' : row.original.ratingAvg.toFixed(1)),
  },
];

const periodColumns: ColumnDef<PeriodReportRow, unknown>[] = [
  {
    accessorKey: 'bucket',
    header: 'Period',
    cell: ({ row }) =>
      new Date(row.original.bucket).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
  },
  { accessorKey: 'jobs', header: 'Jobs' },
  { id: 'gross', header: 'Gross', cell: ({ row }) => money(row.original.grossPaise) },
  {
    id: 'commission',
    header: 'Commission',
    cell: ({ row }) => (
      <span className="tabular-nums text-text-secondary">
        −{formatPaise(row.original.commissionPaise)}
      </span>
    ),
  },
  {
    id: 'driverShare',
    header: 'Driver share',
    cell: ({ row }) => money(row.original.driverSharePaise),
  },
  { id: 'fleetShare', header: 'Fleet share', cell: ({ row }) => money(row.original.fleetSharePaise) },
];

/** §9.3.8: per truck / driver / period; utilization, revenue, compliance history. */
export default function ReportsPage() {
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('truck');
  const [preset, setPreset] = useState<PeriodPreset>('last30');
  const [granularity, setGranularity] = useState<ReportGranularity>('day');
  const [customFrom, setCustomFrom] = useState(istDate(new Date(Date.now() - 29 * 86_400_000)));
  const [customTo, setCustomTo] = useState(istDate());

  const range = preset === 'custom' ? { from: customFrom, to: customTo } : resolvePreset(preset);
  const query: ReportQuery = { groupBy, granularity, ...range };

  const report = useReport(query);
  const data = report.data;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Utilization, revenue, and compliance history — exports run on the read path so live operations never slow down."
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Parameters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Group by">
              <div className="flex flex-wrap gap-1">
                {GROUPS.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                      groupBy === g
                        ? 'bg-brand text-on-brand'
                        : 'bg-surface1 text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {GROUP_LABELS[g]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Period">
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                      preset === p
                        ? 'bg-brand text-on-brand'
                        : 'bg-surface1 text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </Field>

            {preset === 'custom' ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="From" htmlFor="report-from">
                  <Input
                    id="report-from"
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </Field>
                <Field label="To" htmlFor="report-to">
                  <Input
                    id="report-to"
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {groupBy === 'period' ? (
              <Field label="Granularity">
                <div className="flex flex-wrap gap-1">
                  {(['day', 'week', 'month'] as ReportGranularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                        granularity === g
                          ? 'bg-brand text-on-brand'
                          : 'bg-surface1 text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </Field>
            ) : null}

            <Button onClick={() => void report.refetch()} disabled={report.isFetching}>
              {report.isFetching ? 'Generating…' : 'Generate report'}
            </Button>

            {env.useMocks ? (
              <Button variant="outline" disabled title="CSV export needs the real backend (mocks are on)">
                Export CSV
              </Button>
            ) : (
              <a
                href={reportsExportUrl(query)}
                download
                className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}
              >
                Export CSV
              </a>
            )}
          </CardContent>
        </Card>

        <div>
          {report.isError ? (
            <ErrorState onRetry={() => void report.refetch()} />
          ) : !data && !report.isFetching ? (
            <EmptyState
              title="No report generated"
              description={`Pick parameters and generate — “${GROUP_LABELS[groupBy]} · ${PERIOD_LABELS[preset]}” will render here.`}
            />
          ) : (
            <>
              {data ? (
                <p className="mb-3 text-xs text-text-tertiary">
                  {data.period.from} to {data.period.to} · {data.rows.length} rows
                </p>
              ) : null}
              {data?.groupBy === 'driver' ? (
                <DataTable
                  columns={driverColumns}
                  data={data.rows}
                  isLoading={report.isFetching}
                  emptyTitle="No driver earnings in this period"
                />
              ) : data?.groupBy === 'period' ? (
                <DataTable
                  columns={periodColumns}
                  data={data.rows}
                  isLoading={report.isFetching}
                  emptyTitle="No earnings in this period"
                />
              ) : (
                <DataTable
                  columns={truckColumns}
                  data={data?.rows ?? []}
                  isLoading={report.isFetching}
                  emptyTitle="No trucks in this period"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
