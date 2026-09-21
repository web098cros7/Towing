'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CircleDollarSign, TrendingUp, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  ErrorState,
  KpiCard,
  Select,
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
import type { DateRange, JobSplit, Payout, PayoutStatus } from '@/features/earnings/types';
import { addDays, istToday } from '@/features/admin-ops/lib/dashboardRange';
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

type EarningsPreset = 'month' | '7' | '30' | '90';

const PRESET_LABEL: Record<EarningsPreset, string> = {
  month: 'Month',
  '7': '7D',
  '30': '30D',
  '90': '90D',
};

export default function EarningsPage() {
  // Month = backend default (current IST month); day presets bound all three
  // reads to the same trailing window. The statement link always follows the
  // loaded period, so it never disagrees with the numbers on screen.
  const [preset, setPreset] = useState<EarningsPreset>('month');
  const range: DateRange = useMemo(() => {
    if (preset === 'month') return {};
    const days = Number(preset);
    return { from: addDays(istToday(), -(days - 1)), to: istToday() };
  }, [preset]);

  const summary = useEarningsSummary(range);
  const splits = useEarningsSplits(range);
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
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Earnings period"
              data-testid="earnings-range"
              className="h-10 w-28"
              value={preset}
              onChange={(e) => setPreset(e.target.value as EarningsPreset)}
            >
              {(Object.keys(PRESET_LABEL) as EarningsPreset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </Select>
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
            <KpiCard
              label="Wallet balance"
              value={formatPaise(data.wallet.balancePaise)}
              hint={`${formatPaise(data.wallet.availablePaise)} available for payout`}
              icon={<Wallet />}
            />
            <KpiCard
              label="Gross (period)"
              value={formatPaise(data.totals.grossPaise)}
              hint={`${data.totals.jobs} settled jobs`}
              icon={<CircleDollarSign />}
            />
            <KpiCard
              label="Platform commission"
              value={`−${formatPaise(data.totals.commissionPaise)}`}
              icon={<CircleDollarSign />}
            />
            <KpiCard
              label="Fleet share"
              value={formatPaise(data.totals.fleetSharePaise)}
              icon={<TrendingUp />}
              tone="brand"
            />
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
