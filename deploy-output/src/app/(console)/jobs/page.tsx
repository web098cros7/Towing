'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, Button, DataTable, buttonVariants, cn, type ColumnDef } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { jobsExportUrl } from '@/features/jobs/api/jobsDataSource';
import { useJobs } from '@/features/jobs/api/jobs.queries';
import { env } from '@/lib/env';
import { JOB_STATUS_LABEL, type Job, type JobStatus } from '@/features/jobs/types';
import { formatPaise } from '@/lib/money';

const FILTERS: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'en_route', label: 'En route' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusVariant: Record<JobStatus, 'info' | 'success' | 'error' | 'neutral' | 'warning'> = {
  searching: 'warning',
  assigned: 'info',
  en_route: 'info',
  arrived: 'info',
  in_progress: 'info',
  completed: 'success',
  paid: 'success',
  cancelled: 'error',
  no_drivers_found: 'neutral',
  disputed: 'error',
};

const columns: ColumnDef<Job, unknown>[] = [
  {
    accessorKey: 'code',
    header: 'Job',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.code}</div>
        <div className="text-xs text-text-secondary">{row.original.serviceType}</div>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={statusVariant[row.original.status]}>
        {JOB_STATUS_LABEL[row.original.status]}
      </Badge>
    ),
  },
  {
    id: 'route',
    header: 'Route',
    cell: ({ row }) => (
      <div className="text-sm">
        {row.original.pickupArea}
        {row.original.dropArea ? ` → ${row.original.dropArea}` : ''}
        <span className="ml-1 text-xs text-text-tertiary tabular-nums">
          ({row.original.distanceKm} km)
        </span>
      </div>
    ),
  },
  {
    accessorKey: 'driverName',
    header: 'Driver / Truck',
    cell: ({ row }) => (
      <div className="text-sm">
        {row.original.driverName ?? <span className="text-text-tertiary">—</span>}
        {row.original.truckPlate ? (
          <div className="text-xs text-text-secondary">{row.original.truckPlate}</div>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: 'grossPaise',
    header: 'Fare',
    cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.grossPaise)}</span>,
  },
  {
    id: 'commission',
    header: 'Commission',
    cell: ({ row }) =>
      row.original.grossPaise > 0 ? (
        <span className="text-sm tabular-nums">
          {formatPaise(row.original.commissionPaise)}
          {row.original.commissionBand !== null ? (
            <span className="ml-1 text-xs text-text-tertiary">
              ({row.original.commissionBand} · {row.original.commissionPct}%)
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    accessorKey: 'createdAt',
    header: 'When',
    cell: ({ row }) =>
      new Date(row.original.createdAt).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }),
  },
];

export default function JobsPage() {
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const { data, isLoading, isError, refetch } = useJobs({ status });

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Every job routed to your fleet by the platform dispatch engine."
        actions={
          env.useMocks ? (
            <Button variant="outline" disabled title="CSV export needs the real backend (mocks are on)">
              <Download className="size-4" /> Export CSV
            </Button>
          ) : (
            <a
              href={jobsExportUrl({ status })}
              download
              className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}
            >
              <Download className="size-4" /> Export CSV
            </a>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              status === f.value
                ? 'bg-brand text-on-brand'
                : 'bg-surface1 text-text-secondary hover:text-text-primary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No jobs match this filter"
        emptyDescription="Jobs dispatched to your trucks will appear here in real time."
      />
    </div>
  );
}
