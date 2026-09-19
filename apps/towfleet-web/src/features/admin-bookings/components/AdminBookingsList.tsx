'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import {
  Button,
  type ColumnDef,
  DataTable,
  DateRangePicker,
  type DateRange,
  FilterBar,
  SearchInput,
  StatusChip,
} from '@towing/web-ui';
import type { AdminBookingSummary, AdminBookingsQuery, JobStatus } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { formatPaise } from '@/lib/money';
import { useAdminBookings } from '../api/adminBookings.queries';
import { adminBookingsDataSource } from '../api/adminBookingsDataSource';
import { BOOKING_STATUS_TONES, LIVE_PROBLEM_STATUSES } from './bookingStatus';

/** The chips worth a click; the full enum is not a useful filter row. */
const FILTER_STATUSES: JobStatus[] = [
  'assigned',
  'en_route',
  'in_progress',
  'completed',
  'paid',
  'cancelled',
];

const columns: ColumnDef<AdminBookingSummary, unknown>[] = [
  {
    accessorKey: 'code',
    header: 'Booking',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.code}</div>
        <div className="text-xs text-text-secondary">
          {row.original.userName ?? 'Customer'} · {row.original.userMobile}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusChip status={row.original.status} tone={BOOKING_STATUS_TONES[row.original.status]} />
    ),
  },
  {
    id: 'route',
    header: 'Route',
    cell: ({ row }) => (
      <div className="max-w-56">
        <div className="truncate">{row.original.pickupAddress ?? 'Pickup pending'}</div>
        <div className="truncate text-xs text-text-secondary">
          {row.original.dropAddress ?? 'Drop not set'}
        </div>
      </div>
    ),
  },
  {
    id: 'party',
    header: 'Driver / fleet',
    cell: ({ row }) => (
      <div>
        <div>{row.original.driverName ?? 'Unassigned'}</div>
        <div className="text-xs text-text-secondary">{row.original.fleetName ?? '—'}</div>
      </div>
    ),
  },
  {
    accessorKey: 'totalPaise',
    header: 'Total',
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums">{formatPaise(row.original.totalPaise)}</span>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => (
      <span className="text-xs text-text-secondary">
        {new Date(row.original.createdAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </span>
    ),
  },
];

/**
 * W8's bookings console (§9.4.7) — the list an operator triages exceptions
 * from: statuses (any-of), the IST date window, free text over code/address/
 * customer, and the "live problems" chip that is `searching +
 * no_drivers_found` in one click.
 *
 * Rows open the detail; every mutating action lives THERE, because every one
 * of them needs the booking's full context (status, driver, payment state) to
 * be used responsibly.
 */
export function AdminBookingsList() {
  const router = useRouter();

  const [statuses, setStatuses] = useState<JobStatus[]>([]);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  // W6's directory debounce cadence: the server's trigram index is the rate
  // limit, and 250 ms is where typing a code stops re-querying per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [qInput]);

  const liveProblems =
    statuses.length === LIVE_PROBLEM_STATUSES.length &&
    LIVE_PROBLEM_STATUSES.every((status) => statuses.includes(status));

  const query: AdminBookingsQuery = {
    page,
    limit,
    status: statuses.length > 0 ? statuses : undefined,
    from: range.from ?? undefined,
    to: range.to ?? undefined,
    q: q || undefined,
  };

  const { data, isLoading, isError, error, refetch } = useAdminBookings(query);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  // M0-F13's clamp — same reasoning as the Finance queue: a shortening total
  // must not strand the pager past the last page.
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader
          title="Bookings"
          description="Every booking, with the interventions an operator can run on one."
        />
        <AdminForbidden resource="the bookings console" />
      </div>
    );
  }

  const toggleStatus = (status: JobStatus, checked: boolean) => {
    setStatuses((current) =>
      checked ? [...current, status] : current.filter((value) => value !== status),
    );
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Bookings"
        description="Every booking, with the interventions an operator can run on one. Money-bearing endings live in Disputes."
        actions={
          env.useMocks ? (
            <Button variant="outline" disabled title="CSV export needs the real backend (mocks are on)">
              <Download className="size-4" /> Export CSV
            </Button>
          ) : (
            <a href={adminBookingsDataSource.exportCsvUrl(query)} data-testid="bookings-export">
              <Button variant="outline">
                <Download className="size-4" /> Export CSV
              </Button>
            </a>
          )
        }
      />

      <FilterBar className="mb-4">
        <SearchInput
          value={qInput}
          onValueChange={setQInput}
          placeholder="Code, address, name or mobile"
          className="w-72"
          data-testid="bookings-search"
        />
        <DateRangePicker
          value={range}
          onChange={(next) => {
            setRange(next);
            setPage(1);
          }}
        />
        <Button
          variant={liveProblems ? 'primary' : 'outline'}
          size="sm"
          data-testid="bookings-live-problems"
          onClick={() => {
            setStatuses(liveProblems ? [] : [...LIVE_PROBLEM_STATUSES]);
            setPage(1);
          }}
        >
          Live problems
        </Button>
      </FilterBar>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Status filters">
        {FILTER_STATUSES.map((status) => {
          const active = statuses.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              data-testid={`bookings-status-${status}`}
              onClick={() => toggleStatus(status, !active)}
              className={
                active
                  ? 'rounded-lg bg-brand-tint px-3 py-1.5 text-sm font-medium text-brand'
                  : 'rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary'
              }
            >
              {status.replace(/_/g, ' ')}
            </button>
          );
        })}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No bookings match"
        emptyDescription="Widen the status filters or the date window."
        pagination={{ page, pageCount, onPageChange: setPage }}
        onRowClick={(row) => router.push(`/admin/bookings/${row.id}`)}
      />
    </div>
  );
}
