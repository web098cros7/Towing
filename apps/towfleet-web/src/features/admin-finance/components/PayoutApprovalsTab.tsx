'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  type ColumnDef,
  DataTable,
  DateRangePicker,
  type DateRange,
  FilterBar,
  SearchInput,
} from '@towing/web-ui';
import type { AdminPayoutDto, PayoutApprovalState } from '@towing/api-contracts';
import { formatPaise } from '@/lib/money';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminPayouts } from '../api/adminFinance.queries';
import { PayoutDecisionDrawer } from './PayoutDecisionDrawer';
import { PayoutSlaCard } from './PayoutSlaCard';
import { InvariantsPanel } from './InvariantsPanel';

const STATE_LABEL: Record<
  PayoutApprovalState,
  { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' }
> = {
  pending_approval: { label: 'Awaiting approval', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  auto_approved: { label: 'Auto-approved', variant: 'neutral' },
  rejected: { label: 'Rejected', variant: 'error' },
};

const columns: ColumnDef<AdminPayoutDto, unknown>[] = [
  {
    accessorKey: 'ownerName',
    header: 'Payee',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.ownerName ?? 'Unnamed'}</div>
        <div className="text-xs text-text-secondary capitalize">{row.original.ownerType}</div>
      </div>
    ),
  },
  {
    accessorKey: 'amountPaise',
    header: 'Amount',
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums">{formatPaise(row.original.amountPaise)}</span>
    ),
  },
  {
    accessorKey: 'destinationLast4',
    header: 'Destination',
    cell: ({ row }) =>
      row.original.destinationLast4 ? (
        <div>
          <div>{row.original.bankName ?? 'Bank account'}</div>
          {/*
            Redacted, because that is all the platform HAS: the full number goes
            to Razorpay Route at onboarding and only the last four digits plus a
            fingerprint are persisted. A reviewer can still sanity-check where
            the money is going.
          */}
          <div className="text-xs tabular-nums text-text-secondary">
            •••• {row.original.destinationLast4}
          </div>
        </div>
      ) : (
        <span className="text-text-tertiary">Not linked</span>
      ),
  },
  {
    accessorKey: 'approvalState',
    header: 'Status',
    cell: ({ row }) => {
      const meta = STATE_LABEL[row.original.approvalState];
      return <Badge variant={meta.variant}>{meta.label}</Badge>;
    },
  },
  {
    accessorKey: 'requestedAt',
    header: 'Requested',
    cell: ({ row }) =>
      new Date(row.original.requestedAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
  },
];

/**
 * §9.4.10's Finance approval queue — the SECOND admin surface, after Phase 11's
 * KYC queue, and the `finance` sub-role's first consumer with any authority.
 *
 * BOTH OWNER TYPES APPEAR HERE. Fleet payouts bypassed approval entirely from
 * Track A Phase 7 until Phase 19; bringing them under one §14.4 threshold
 * rather than leaving a second, unreviewed path is the point of the rule, and
 * it is a behaviour change for existing fleets rather than a new feature.
 *
 * W9 added the name/date filters (the queue is where an operator arrives with a
 * driver's name in hand) and put the SLA card and the invariants panel BELOW
 * the table: both answer questions about the same queue, and a separate "health"
 * tab is one nobody opens until something is already wrong.
 */
export function PayoutApprovalsTab() {
  const [state, setState] = useState<PayoutApprovalState | 'all'>('pending_approval');
  // A20: server-side paging over the API's page envelope — the queue is
  // unbounded, and page 1 / limit 50 left everything past the threshold
  // unreachable.
  const [page, setPage] = useState(1);
  const limit = 50;
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [selected, setSelected] = useState<AdminPayoutDto | null>(null);

  // W6's directory cadence: 300 ms is where typing a payee's name stops
  // re-querying per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  const { data, isLoading, isError, error, refetch } = useAdminPayouts({
    state,
    page,
    limit,
    q: q || undefined,
    from: range.from ?? undefined,
    to: range.to ?? undefined,
  });

  // `total`, never `items.length`: the last page is short by definition.
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  // M0-F13: clamp when the total shrinks under the current page (e.g.
  // approving the last rows while sitting on page 2). Without this the table
  // renders its empty state — which hides the pager — with no way back to
  // page 1. Guarded on `data`: a page change swaps the query key, and until
  // the new page resolves `data` is undefined (pageCount 1) — clamping on the
  // transient would yank every page turn back to page 1.
  useEffect(() => {
    if (data !== undefined && page > pageCount) setPage(pageCount);
  }, [data, page, pageCount]);

  // A7: a valid session without the queue's sub-role is refused, not broken.
  if (error instanceof ApiError && error.status === 403) {
    return <AdminForbidden resource="the payout queue" />;
  }

  return (
    <div>
      <h2 className="mb-1 font-display text-xl font-bold">Payout approvals</h2>
      <p className="mb-4 text-sm text-text-secondary">
        Driver and fleet payouts above the auto-approval threshold. Approving sends the money; the
        wallet is already debited either way.
      </p>

      <FilterBar className="mb-3">
        <SearchInput
          value={qInput}
          onValueChange={setQInput}
          placeholder="Payee name"
          className="w-56"
          data-testid="finance-search"
        />
        <DateRangePicker
          value={range}
          onChange={(next) => {
            setRange(next);
            setPage(1);
          }}
          fromLabel="Requested from"
          toLabel="To"
        />
      </FilterBar>

      <div className="mb-4 flex gap-2">
        {(['pending_approval', 'all'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setState(option);
              // A filter change re-queries from the top — page 2 of one
              // filter is meaningless on another.
              setPage(1);
            }}
            data-testid={`finance-filter-${option}`}
            className={
              state === option
                ? 'rounded-lg bg-brand-tint px-3 py-1.5 text-sm font-medium text-brand'
                : 'rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary'
            }
          >
            {option === 'pending_approval' ? 'Awaiting approval' : 'All payouts'}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="Nothing to approve"
        emptyDescription="Payouts above the threshold appear here. Everything below it goes straight to the bank."
        pagination={{ page, pageCount, onPageChange: setPage }}
      />

      <PayoutDecisionDrawer payout={selected} onClose={() => setSelected(null)} />

      <PayoutSlaCard />
      <InvariantsPanel />
    </div>
  );
}
