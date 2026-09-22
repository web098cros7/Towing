'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { type ColumnDef, DataTable, FilterBar, Select, StatusChip, Tabs } from '@towing/web-ui';
import type { AdminDispute, DisputeReasonCode, DisputeStatus } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { ApiError } from '@/lib/apiClient';
import { formatPaise } from '@/lib/money';
import { useAdminDisputes } from '../api/adminDisputes.queries';
import { DISPUTE_REASON_LABELS } from '@/features/admin-bookings/components/bookingStatus';
import { DisputeDrawer } from './DisputeDrawer';
import { DISPUTE_REASON_CODES } from '@towing/api-contracts';

const STATUS_TONE: Record<DisputeStatus, 'warning' | 'info' | 'success'> = {
  open: 'warning',
  under_review: 'info',
  resolved: 'success',
};

const columns: ColumnDef<AdminDispute, unknown>[] = [
  {
    accessorKey: 'booking',
    header: 'Booking',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.booking.code}</div>
        <div className="text-xs text-text-secondary">
          {row.original.booking.customerName ?? 'Customer'} ·{' '}
          {formatPaise(row.original.booking.totalPaise)}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'reasonCode',
    header: 'Reason',
    cell: ({ row }) => DISPUTE_REASON_LABELS[row.original.reasonCode] ?? row.original.reasonCode,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusChip status={row.original.status} tone={STATUS_TONE[row.original.status]} />
    ),
  },
  {
    accessorKey: 'openedFromStatus',
    header: 'Opened from',
    cell: ({ row }) => (
      <span className="text-text-secondary">
        {row.original.openedFromStatus.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    id: 'assignee',
    header: 'Owner',
    cell: ({ row }) =>
      row.original.assignedAdminName ?? <span className="text-text-tertiary">Unassigned</span>,
  },
  {
    id: 'resolution',
    header: 'Resolution',
    cell: ({ row }) =>
      row.original.resolution ? (
        <div>
          <div className="capitalize">{row.original.resolution.replace(/_/g, ' ')}</div>
          {row.original.refundAmountPaise !== null ? (
            <div className="text-xs text-text-secondary">
              {formatPaise(row.original.refundAmountPaise)}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Opened',
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
 * §5.6's dispute queue — the second half of W8's money surface.
 *
 * Default tab is `open`: somebody opening this page came to work the queue,
 * not to audit history (the resolved tab is one click away, with the outcome
 * and the refund amount on the row). `?dispute=<id>` deep-links the drawer,
 * which is how the booking detail's banner lands here.
 */
export function AdminDisputesQueue() {
  const searchParams = useSearchParams();
  const { admin } = useAdminIdentity();

  const [statusTab, setStatusTab] = useState<DisputeStatus | 'all'>('open');
  const [reasonCode, setReasonCode] = useState<DisputeReasonCode | ''>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('dispute'));

  const query = {
    page,
    limit,
    status: statusTab === 'all' ? undefined : statusTab,
    reasonCode: reasonCode || undefined,
    assignedAdminId: mineOnly && admin ? admin.id : undefined,
  };

  const { data, isLoading, isError, error, refetch } = useAdminDisputes(query);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader
          title="Disputes"
          description="Every open complaint, and the five exits that end one."
        />
        <AdminForbidden resource="the dispute queue" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Disputes"
        description="Every open complaint. Resolving moves the booking and the money together — the exits available depend on where the dispute opened from."
      />

      <Tabs
        items={[
          { value: 'open', label: 'Open' },
          { value: 'under_review', label: 'Under review' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'all', label: 'All' },
        ]}
        value={statusTab}
        onChange={(value) => {
          setStatusTab(value);
          setPage(1);
        }}
        aria-label="Dispute status"
      />

      <FilterBar className="mb-4 mt-3">
        <Select
          className="w-56"
          value={reasonCode}
          onChange={(event) => {
            setReasonCode(event.target.value as DisputeReasonCode | '');
            setPage(1);
          }}
          data-testid="disputes-reason"
          aria-label="Reason filter"
        >
          <option value="">All reasons</option>
          {DISPUTE_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {DISPUTE_REASON_LABELS[code] ?? code}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={mineOnly}
            onChange={(event) => {
              setMineOnly(event.target.checked);
              setPage(1);
            }}
            data-testid="disputes-mine"
          />
          Assigned to me
        </label>
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No disputes here"
        emptyDescription="Nothing matches this tab and reason."
        pagination={{ page, pageCount, onPageChange: setPage }}
        onRowClick={(row) => setSelectedId(row.id)}
      />

      <DisputeDrawer disputeId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
