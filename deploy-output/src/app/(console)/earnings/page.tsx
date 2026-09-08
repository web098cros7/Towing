'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  ErrorState,
  Skeleton,
  buttonVariants,
  cn,
  type ColumnDef,
} from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import {
  useEarningsSplits,
  useEarningsSummary,
  usePayouts,
} from '@/features/earnings/api/earnings.queries';
import { statementCsvUrl } from '@/features/earnings/api/earningsDataSource';
import { EarningsTrendChart } from '@/features/earnings/components/EarningsTrendChart';
import { RequestPayoutDialog } from '@/features/earnings/components/RequestPayoutDialog';
import type { JobSplit, Payout, PayoutStatus } from '@/features/earnings/types';
import { env } from '@/lib/env';
import { formatPaise } from '@/lib/money';

const splitColumns: ColumnDef<JobSplit, unknown>[] = [
  {
    accessorKey: 'jobCode',
    header: 'Job',
    cell: ({ row }) => (
      <div>
        <div className="font-semibold">{row.original.jobCode}</div>
        <div className="text-xs text-text-secondary">
          {new Date(row.original.settledAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          })}{' '}
          · {row.original.driverName ?? '—'}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'grossPaise',
    header: 'Gross fare',
    cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.grossPaise)}</span>,
  },
  {
    id: 'commission',
    header: 'Platform commission',
    cell: ({ row }) => (
      <span className="tabular-nums text-text-secondary">
        −{formatPaise(row.original.commissionPaise)}
        <span className="ml-1 text-xs text-text-tertiary">
          ({row.original.commissionBand ?? '—'} · {row.original.commissionPct ?? '—'}%)
        </span>
      </span>
    ),
  },
  {
    accessorKey: 'driverSharePaise',
    header: 'Driver share',
    cell: ({ row }) => (
      <span className="tabular-nums">{formatPaise(row.original.driverSharePaise)}</span>
    ),
  },
  {
    accessorKey: 'fleetSharePaise',
    header: 'Fleet share',
    cell: ({ row }) => (
      <span className="font-semibold tabular-nums">{formatPaise(row.original.fleetSharePaise)}</span>
    ),
  },
];

/** `requested`, not `pending` — §5.5's vocabulary, straight off the contract. */
const payoutVariant: Record<PayoutStatus, 'warning' | 'info' | 'success' | 'error'> = {
  requested: 'warning',
  processing: 'info',
  paid: 'success',
  failed: 'error',
};

function PayoutRow({ payout }: { payout: Payout }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold tabular-nums">{formatPaise(payout.amountPaise)}</div>
        <div className="text-xs text-text-secondary">
          {new Date(payout.requestedAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </div>
        {payout.failureReason ? (
          <div className="mt-1 text-xs text-error">{payout.failureReason}</div>
        ) : null}
      </div>
      <Badge variant={payoutVariant[payout.status]}>{payout.status}</Badge>
    </div>
  );
}

export default function EarningsPage() {
  const summary = useEarningsSummary();
  const splits = useEarningsSplits();
  const payouts = usePayouts();
  const [payoutOpen, setPayoutOpen] = useState(false);

  const data = summary.data;

  if (summary.isError) {
    return (
      <div>
        <PageHeader title="Earnings & Payouts" />
        <ErrorState onRetry={() => void summary.refetch()} />
      </div>
    );
  }

  /**
   * The EFFECTIVE fleet share for the period, computed from the totals.
   *
   * There is deliberately no `fleetSharePct` on the wire any more: the share is
   * configured per driver, so a fleet running 80/20 and 70/30 has no single
   * number and the old field was a lie at the summary level.
   */
  const effectiveSharePct =
    data && data.totals.poolPaise > 0
      ? Math.round((data.totals.fleetSharePaise / data.totals.poolPaise) * 1000) / 10
      : null;

  const canRequest =
    !!data &&
    data.wallet.payoutAccountLinked &&
    data.wallet.availablePaise >= data.wallet.minPayoutPaise;

  const requestHint = !data
    ? undefined
    : !data.wallet.payoutAccountLinked
      ? 'Link a bank account in Settings to request payouts'
      : data.wallet.availablePaise < data.wallet.minPayoutPaise
        ? `Minimum payout is ${formatPaise(data.wallet.minPayoutPaise)}`
        : undefined;

  const month = (data?.period.to ?? new Date().toISOString().slice(0, 10)).slice(0, 7);

  return (
    <div>
      <PageHeader
        title="Earnings & Payouts"
        description={
          effectiveSharePct === null
            ? 'Per-job split after platform commission.'
            : `Per-job split after platform commission — your effective fleet share this period is ${effectiveSharePct}% of the driver pool.`
        }
        actions={
          <div className="flex items-center gap-2">
            {env.useMocks ? (
              <Button variant="outline" disabled title="Statement export needs the real backend (mocks are on)">
                Statement CSV
              </Button>
            ) : (
              <a
                href={statementCsvUrl(month)}
                download
                className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}
              >
                Statement CSV
              </a>
            )}
            <Link
              href={`/statement/${month}`}
              target="_blank"
              className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}
            >
              Print statement
            </Link>
            <Button onClick={() => setPayoutOpen(true)} disabled={!canRequest} title={requestHint}>
              Request payout
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.isLoading || !data ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-0">
                <CardTitle>Wallet balance</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-3xl font-bold tabular-nums">
                  {formatPaise(data.wallet.balancePaise)}
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  {formatPaise(data.wallet.availablePaise)} available for payout
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0">
                <CardTitle>Gross (period)</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-3xl font-bold tabular-nums">
                  {formatPaise(data.totals.grossPaise)}
                </div>
                <p className="mt-1 text-xs text-text-tertiary">{data.totals.jobs} settled jobs</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0">
                <CardTitle>Platform commission</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-3xl font-bold tabular-nums">
                  −{formatPaise(data.totals.commissionPaise)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0">
                <CardTitle>Fleet share</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="text-3xl font-bold tabular-nums text-brand">
                  {formatPaise(data.totals.fleetSharePaise)}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Fleet share — this period</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.isLoading || !data ? (
              <Skeleton className="h-60" />
            ) : (
              <EarningsTrendChart data={data.trend} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payout history</CardTitle>
          </CardHeader>
          <CardContent>
            {payouts.isLoading ? (
              <Skeleton className="h-40" />
            ) : (payouts.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">No payouts yet.</p>
            ) : (
              payouts.data!.map((p) => <PayoutRow key={p.id} payout={p} />)
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
        Split breakdown per job
      </h2>
      <DataTable
        columns={splitColumns}
        data={splits.data ?? []}
        isLoading={splits.isLoading}
        emptyTitle="No settled jobs yet"
        emptyDescription="Split breakdowns appear once jobs complete and payments settle."
      />

      {data ? (
        <RequestPayoutDialog
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          wallet={data.wallet}
        />
      ) : null}
    </div>
  );
}
