'use client';

import { useState } from 'react';
import { Badge, type ColumnDef, DataTable } from '@towing/web-ui';
import type { AdminPayoutDto, PayoutApprovalState } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { formatPaise } from '@/lib/money';
import { useAdminPayouts } from '@/features/admin-finance/api/adminFinance.queries';
import { PayoutDecisionDrawer } from '@/features/admin-finance/components/PayoutDecisionDrawer';

const STATE_LABEL: Record<PayoutApprovalState, { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' }> =
  {
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
 */
export default function AdminFinancePage() {
  const [state, setState] = useState<PayoutApprovalState | 'all'>('pending_approval');
  const [selected, setSelected] = useState<AdminPayoutDto | null>(null);

  const { data, isLoading, isError, refetch } = useAdminPayouts({
    state,
    page: 1,
    limit: 50,
  });

  return (
    <div>
      <PageHeader
        title="Payout approvals"
        description="Driver and fleet payouts above the auto-approval threshold. Approving sends the money; the wallet is already debited either way."
      />

      <div className="mb-4 flex gap-2">
        {(['pending_approval', 'all'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setState(option)}
            data-testid={`finance-filter-${option}`}
            className={
              state === option
                ? 'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white'
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
      />

      <PayoutDecisionDrawer payout={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
