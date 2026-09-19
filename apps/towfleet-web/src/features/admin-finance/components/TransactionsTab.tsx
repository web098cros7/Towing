'use client';

import { useEffect, useState } from 'react';
import {
  type ColumnDef,
  DataTable,
  FilterBar,
  SearchInput,
  Select,
  StatusChip,
} from '@towing/web-ui';
import type {
  AdminTransactionDto,
  PaymentPurpose,
  PaymentStatusValue,
} from '@towing/api-contracts';
import { formatPaise } from '@/lib/money';
import { useAdminTransactions } from '../api/adminFinance.queries';

const STATUS_TONE: Record<PaymentStatusValue, 'success' | 'warning' | 'error' | 'neutral'> = {
  pending: 'warning',
  authorized: 'warning',
  captured: 'success',
  failed: 'error',
  refunded: 'neutral',
};

const columns: ColumnDef<AdminTransactionDto, unknown>[] = [
  {
    accessorKey: 'bookingCode',
    header: 'Booking',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.bookingCode}</div>
        <div className="text-xs text-text-secondary">{row.original.customerName ?? 'Customer'}</div>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusChip status={row.original.status} tone={STATUS_TONE[row.original.status]} />
    ),
  },
  {
    accessorKey: 'purpose',
    header: 'Purpose',
    cell: ({ row }) => (
      <span className="capitalize">{row.original.purpose.replace(/_/g, ' ')}</span>
    ),
  },
  {
    accessorKey: 'method',
    header: 'Method',
    cell: ({ row }) => <span className="uppercase">{row.original.method}</span>,
  },
  {
    accessorKey: 'amountPaise',
    header: 'Amount',
    cell: ({ row }) => (
      <div className="text-right">
        <div className="font-semibold tabular-nums">{formatPaise(row.original.amountPaise)}</div>
        {row.original.refundedAmountPaise > 0 ? (
          <div className="text-xs tabular-nums text-text-secondary">
            −{formatPaise(row.original.refundedAmountPaise)} refunded
          </div>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: 'gatewayRef',
    header: 'Gateway ref',
    cell: ({ row }) =>
      row.original.gatewayRef ? (
        <span className="font-mono text-xs">{row.original.gatewayRef}</span>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
  {
    accessorKey: 'capturedAt',
    header: 'Captured',
    cell: ({ row }) =>
      row.original.capturedAt ? (
        <span className="text-xs text-text-secondary">
          {new Date(row.original.capturedAt).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      ) : row.original.failureReason ? (
        <span className="text-xs text-error">{row.original.failureReason}</span>
      ) : (
        <span className="text-text-tertiary">—</span>
      ),
  },
];

/**
 * W9's transactions table: every payment, whatever its fate — which is the
 * point. A refunds-only or captures-only view hides the FAILED attempts, and a
 * customer on the phone is usually one of those.
 */
export function TransactionsTab() {
  const [status, setStatus] = useState<PaymentStatusValue | ''>('');
  const [purpose, setPurpose] = useState<PaymentPurpose | ''>('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [qInput]);

  const { data, isLoading, isError, refetch } = useAdminTransactions({
    page,
    limit,
    status: status || undefined,
    purpose: purpose || undefined,
    q: q || undefined,
  });

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  return (
    <div>
      <h2 className="mb-1 font-display text-xl font-bold">Transactions</h2>
      <p className="mb-4 text-sm text-text-secondary">
        Every payment attempt, its gateway reference and how much of it has been refunded.
      </p>

      <FilterBar className="mb-3">
        <SearchInput
          value={qInput}
          onValueChange={setQInput}
          placeholder="Booking, customer or gateway ref"
          className="w-72"
          data-testid="transactions-search"
        />
        <Select
          className="w-44"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as PaymentStatusValue | '');
            setPage(1);
          }}
          aria-label="Status filter"
          data-testid="transactions-status"
        >
          <option value="">All states</option>
          {(['pending', 'authorized', 'captured', 'failed', 'refunded'] as const).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          value={purpose}
          onChange={(event) => {
            setPurpose(event.target.value as PaymentPurpose | '');
            setPage(1);
          }}
          aria-label="Purpose filter"
          data-testid="transactions-purpose"
        >
          <option value="">All purposes</option>
          <option value="booking">Booking</option>
          <option value="cancellation_fee">Cancellation fee</option>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No transactions match"
        emptyDescription="Clear the filters or widen the date window."
        pagination={{ page, pageCount, onPageChange: setPage }}
      />
    </div>
  );
}
