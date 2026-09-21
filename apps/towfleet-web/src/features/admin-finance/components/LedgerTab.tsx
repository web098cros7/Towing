'use client';

import { useState } from 'react';
import { Button, type ColumnDef, DataTable, FilterBar, Select } from '@towing/web-ui';
import type { AdminLedgerEntryDto, WalletOwnerKind, WalletTxnType } from '@towing/api-contracts';
import { formatPaise } from '@/lib/money';
import { useAdminLedger } from '../api/adminFinance.queries';

const TYPE_LABELS: Record<WalletTxnType, string> = {
  fare_credit: 'Fare credit',
  commission_debit: 'Commission debit',
  fleet_share_credit: 'Fleet share credit',
  driver_share_credit: 'Driver share credit',
  payout_debit: 'Payout debit',
  refund_debit: 'Refund clawback',
  refund_credit: 'Refund credit',
  adjustment: 'Adjustment',
};

const columns: ColumnDef<AdminLedgerEntryDto, unknown>[] = [
  {
    accessorKey: 'createdAt',
    header: 'When',
    cell: ({ row }) => (
      <span className="text-xs text-text-secondary">
        {new Date(row.original.createdAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </span>
    ),
  },
  {
    id: 'owner',
    header: 'Wallet',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.ownerName ?? 'Unnamed'}</div>
        <div className="text-xs capitalize text-text-secondary">{row.original.ownerType}</div>
      </div>
    ),
  },
  {
    accessorKey: 'type',
    header: 'Leg',
    cell: ({ row }) => TYPE_LABELS[row.original.type] ?? row.original.type,
  },
  {
    accessorKey: 'amountPaise',
    header: 'Amount',
    cell: ({ row }) => (
      /*
        SIGNED, and coloured by sign: credits positive, debits negative is the
        ledger's own convention (SUM == balance), and rendering a debit as a
        plain positive number is how a reconciliation reads backwards.
      */
      <span
        className={
          row.original.amountPaise < 0
            ? 'font-semibold tabular-nums text-error'
            : 'font-semibold tabular-nums text-success-soft-fg'
        }
      >
        {row.original.amountPaise > 0 ? '+' : ''}
        {formatPaise(row.original.amountPaise)}
      </span>
    ),
  },
  {
    accessorKey: 'bookingCode',
    header: 'Ref',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.bookingCode ?? '—'}</span>,
  },
  {
    accessorKey: 'reason',
    header: 'Reason',
    cell: ({ row }) => (
      <span className="text-xs text-text-secondary">{row.original.reason ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'idempotencyKey',
    header: 'Key',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-text-tertiary">{row.original.idempotencyKey}</span>
    ),
  },
];

/**
 * The wallet ledger viewer — §14.1's append-only truth, paged BACKWARDS with
 * an opaque cursor on purpose: the feed only ever gains rows, so page 2 of a
 * page-numbered read means something different by the time an operator gets
 * there.
 *
 * "Newer" walks back through the cursors this session has seen rather than
 * re-deriving an ascending cursor — a small stack, and the only correct answer
 * once the feed has moved.
 */
export function LedgerTab() {
  const [ownerType, setOwnerType] = useState<WalletOwnerKind | ''>('');
  const [type, setType] = useState<WalletTxnType | ''>('');
  // Session cursor history: [undefined] means "at the newest page".
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursorStack[cursorStack.length - 1];

  const { data, isLoading, isError, refetch } = useAdminLedger({
    limit: 50,
    cursor,
    ownerType: ownerType || undefined,
    type: type || undefined,
  });

  const resetTo = (next: typeof ownerType) => {
    setOwnerType(next);
    setCursorStack([undefined]);
  };

  return (
    <div>
      <h2 className="mb-1 font-display text-xl font-bold">Wallet ledger</h2>
      <p className="mb-4 text-sm text-text-secondary">
        Every leg, signed. A balance is a projection of this list and nothing else — if the two
        disagree, the invariants panel says so.
      </p>

      <FilterBar className="mb-3">
        <Select
          className="w-44"
          value={ownerType}
          onChange={(event) => resetTo(event.target.value as WalletOwnerKind | '')}
          aria-label="Owner filter"
          data-testid="ledger-owner"
        >
          <option value="">All wallet owners</option>
          <option value="driver">Drivers</option>
          <option value="fleet">Fleets</option>
          <option value="user">Customers</option>
        </Select>
        <Select
          className="w-52"
          value={type}
          onChange={(event) => {
            setType(event.target.value as WalletTxnType | '');
            setCursorStack([undefined]);
          }}
          aria-label="Leg type filter"
          data-testid="ledger-type"
        >
          <option value="">All leg types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="No ledger entries"
        emptyDescription="Money that has never moved leaves no legs."
      />

      <div className="mt-3 flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={cursorStack.length === 1}
          onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
          data-testid="ledger-newer"
        >
          Newer
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!data?.nextCursor}
          onClick={() =>
            setCursorStack((stack) => (data?.nextCursor ? [...stack, data.nextCursor] : stack))
          }
          data-testid="ledger-older"
        >
          Older
        </Button>
      </div>
    </div>
  );
}
