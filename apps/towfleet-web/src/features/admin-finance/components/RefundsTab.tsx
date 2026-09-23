'use client';

import { useState } from 'react';
import { Button, type ColumnDef, DataTable, FilterBar, Select, StatusChip } from '@towing/web-ui';
import type { AdminRefundRowDto, RefundKind, RefundStatus } from '@towing/api-contracts';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { formatPaise } from '@/lib/money';
import { useAdminRefunds } from '../api/adminFinance.queries';
import { RefundDrawer } from './RefundDrawer';
import { bearerShortLabel } from './RefundTermsFields';

const columns: ColumnDef<AdminRefundRowDto, unknown>[] = [
  {
    accessorKey: 'bookingCode',
    header: 'Booking',
    cell: ({ row }) => <span className="font-semibold">{row.original.bookingCode}</span>,
  },
  {
    accessorKey: 'kind',
    header: 'Kind',
    cell: ({ row }) => <span className="capitalize">{row.original.kind}</span>,
  },
  {
    accessorKey: 'amountPaise',
    header: 'Amount',
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums text-error">
        −{formatPaise(row.original.amountPaise)}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusChip
        status={row.original.status}
        tone={
          row.original.status === 'processed'
            ? 'success'
            : row.original.status === 'failed'
              ? 'error'
              : 'warning'
        }
      />
    ),
  },
  {
    id: 'borne',
    header: 'Borne by',
    cell: ({ row }) =>
      row.original.liability ? (
        <span className="capitalize">{bearerShortLabel(row.original.liability)}</span>
      ) : (
        // A full refund has no liability: it reverses every party's share.
        <span className="text-text-tertiary">Full reversal</span>
      ),
  },
  {
    accessorKey: 'reason',
    header: 'Reason',
    cell: ({ row }) => (
      <span className="text-xs text-text-secondary">{row.original.reason ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'initiatedBy',
    header: 'Issued by',
    cell: ({ row }) => {
      const value = row.original.initiatedBy;
      return value === 'system' ? (
        <span className="text-text-secondary">System</span>
      ) : (
        <span className="font-mono text-xs">{value.slice(0, 8)}…</span>
      );
    },
  },
  {
    accessorKey: 'processedAt',
    header: 'Processed',
    cell: ({ row }) =>
      row.original.processedAt ? (
        <span className="text-xs text-text-secondary">
          {new Date(row.original.processedAt).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      ) : (
        <span className="text-text-tertiary">Pending</span>
      ),
  },
];

/**
 * W9's refunds list plus the ISSUE action — the screen §14.5's whole story
 * hangs off. Full and partial ref are the same request shape; the drawer
 * decides which by whether an amount was typed.
 */
export function RefundsTab() {
  const { admin } = useAdminIdentity();
  const [status, setStatus] = useState<RefundStatus | ''>('');
  const [kind, setKind] = useState<RefundKind | ''>('');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const limit = 50;

  const { data, isLoading, isError, refetch } = useAdminRefunds({
    page,
    limit,
    status: status || undefined,
    kind: kind || undefined,
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold">Refunds</h2>
          <p className="text-sm text-text-secondary">
            Every reversal, whatever issued it. Issuing one here moves money — it needs a reason and
            an idempotency key.
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)} data-testid="refund-issue-open">
          Issue refund
        </Button>
      </div>

      <FilterBar className="mb-3 mt-3">
        <Select
          className="w-40"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as RefundStatus | '');
            setPage(1);
          }}
          aria-label="Refund status filter"
          data-testid="refunds-status"
        >
          <option value="">All states</option>
          <option value="processed">Processed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </Select>
        <Select
          className="w-40"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as RefundKind | '');
            setPage(1);
          }}
          aria-label="Refund kind filter"
          data-testid="refunds-kind"
        >
          <option value="">Full and partial</option>
          <option value="full">Full</option>
          <option value="partial">Partial</option>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No refunds yet"
        emptyDescription="Nothing has been given back on this platform."
        pagination={{ page, pageCount, onPageChange: setPage }}
      />

      <RefundDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        operatorName={admin?.name ?? null}
      />
    </div>
  );
}
