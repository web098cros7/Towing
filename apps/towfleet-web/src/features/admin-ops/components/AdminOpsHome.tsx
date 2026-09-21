'use client';

import { useMemo, useState } from 'react';
import type {
  AdminOpsKpis,
  AnalyticsBandDay,
  AnalyticsDay,
  AnalyticsTotals,
} from '@towing/api-contracts';
import { Badge, ErrorState, KpiCard, Select, Skeleton } from '@towing/web-ui';
import { Briefcase, Gauge, TrendingDown, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useAdminCan } from '@/components/admin/Can';
import { useAdminRealtime } from '@/features/admin-realtime/AdminRealtimeProvider';
import { ApiError } from '@/lib/apiClient';
import { formatPaise } from '@/lib/money';
import {
  useAnalyticsRevenue,
  useAnalyticsSummary,
} from '@/features/admin-analytics/api/adminAnalytics.queries';
import { useAdminOpsActivity, useAdminOpsDashboard } from '../api/adminOps.queries';
import { ActivityFeed } from './ActivityFeed';
import { LiveNowCard } from './LiveNowCard';
import {
  BandMixCard,
  BookingsGrowthCard,
  RevenueOverviewCard,
  toBandSlices,
  toGrowthPoints,
  toRevenuePoints,
} from './OpsCharts';
import { OpsStatCard } from './OpsStatCard';
import { DASHBOARD_RANGES, formatPaiseINR, periodDelta, rangeFor } from '../lib/dashboardRange';

/**
 * §9.4.2's ops dashboard — the `/admin` landing for every `ops.live` holder.
 *
 * Two layers: LIVE numbers (socket-patched KPIs in `LiveNowCard`) up top of
 * the attention stack, and TRENDS below from the analytics rollup (GMV area,
 * booking growth, band mix, delta pills). Freshness is push-first:
 * `ops:metrics` frames patch the cached dashboard in the realtime provider,
 * and the query falls back to 10 s polling only while the transport itself
 * is down. Numbers are formatted from the same contract types the backend
 * e2e asserts exactly against a hand-built day.
 */
export function AdminOpsHome(): React.ReactNode {
  const { mode } = useAdminRealtime();
  const can = useAdminCan();
  const dashboard = useAdminOpsDashboard(true, mode);
  const activity = useAdminOpsActivity(true, mode);

  const [rangeDays, setRangeDays] = useState<number>(30);
  const range = useMemo(() => rangeFor(rangeDays), [rangeDays]);
  const rangeLabel = DASHBOARD_RANGES.find((r) => r.days === rangeDays)?.label ?? `${rangeDays}D`;

  // Trends need `analytics.view`; without it (or on a 403) the dashboard
  // degrades to the live-only grid rather than erroring the whole page.
  const trendsAllowed = can('analytics.view');
  const summary = useAnalyticsSummary(range, trendsAllowed);
  const revenue = useAnalyticsRevenue(range, trendsAllowed);
  const trendsForbidden =
    summary.error instanceof ApiError && summary.error.status === 403;

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Live marketplace pulse, with revenue and growth trends below."
        actions={
          <>
            <span
              title={mode === 'live' ? 'Realtime connected' : 'REST polling fallback'}
              className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary sm:flex"
              data-testid="ops-live-badge"
            >
              <span
                className={`size-1.5 rounded-full ${mode === 'live' ? 'bg-success' : 'bg-warning'}`}
              />
              {mode === 'live' ? 'Live' : mode}
            </span>
            {trendsAllowed ? (
              <Select
                aria-label="Trend range"
                data-testid="ops-range"
                className="h-9 w-24"
                value={String(rangeDays)}
                onChange={(e) => setRangeDays(Number(e.target.value))}
              >
                {DASHBOARD_RANGES.map((r) => (
                  <option key={r.days} value={String(r.days)}>
                    {r.label}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        }
      />

      {dashboard.isError ? (
        <ErrorState onRetry={() => void dashboard.refetch()} />
      ) : dashboard.isLoading || !dashboard.data ? (
        <DashboardSkeleton />
      ) : !trendsAllowed || trendsForbidden ? (
        /* No analytics permission — live KPIs only, same as before. */
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTiles kpis={dashboard.data.kpis} />
          </div>
          <ActivityFeed activity={activity} />
        </div>
      ) : summary.isError || revenue.isError ? (
        <ErrorState
          onRetry={() => {
            void summary.refetch();
            void revenue.refetch();
          }}
        />
      ) : summary.isLoading || revenue.isLoading || !summary.data || !revenue.data ? (
        <DashboardSkeleton />
      ) : (
        <TrendsDashboard
          kpis={dashboard.data.kpis}
          degraded={dashboard.data.degraded}
          summaryDays={summary.data.days}
          totals={summary.data.totals}
          bands={revenue.data.bands}
          rangeLabel={rangeLabel}
          activity={activity}
        />
      )}
    </div>
  );
}

function TrendsDashboard({
  kpis,
  degraded,
  summaryDays,
  totals,
  bands,
  rangeLabel,
  activity,
}: {
  kpis: AdminOpsKpis;
  degraded: boolean;
  summaryDays: AnalyticsDay[];
  totals: AnalyticsTotals;
  bands: AnalyticsBandDay[];
  rangeLabel: string;
  activity: ReturnType<typeof useAdminOpsActivity>;
}): React.ReactNode {
  const gmvDelta = periodDelta(summaryDays.map((d) => d.gmvPaise));
  const paidDelta = periodDelta(summaryDays.map((d) => d.bookingsPaid));
  const customersDelta = periodDelta(summaryDays.map((d) => d.newCustomers));
  const caption = gmvDelta.halfDays > 0 ? `vs prior ${gmvDelta.halfDays}d` : 'vs prior period';

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {degraded ? (
        <div>
          <Badge variant="warning" title="Redis unavailable — served from Postgres">
            Degraded: dispatchable-now count unavailable
          </Badge>
        </div>
      ) : null}

      {/* Row 1 — revenue hero (2 cols) + four delta stat cards (right rail). */}
      <div className="grid gap-4 md:gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RevenueOverviewCard
            points={toRevenuePoints(summaryDays)}
            totalGmv={Math.round(totals.gmvPaise / 100)}
            deltaPct={gmvDelta.pct}
            caption={`${caption} · ${rangeLabel}`}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:gap-5 xl:col-span-1 xl:grid-cols-2">
          <OpsStatCard
            label="Paid bookings"
            value={totals.bookingsPaid.toLocaleString('en-IN')}
            deltaPct={paidDelta.pct}
            caption={caption}
            icon={<Briefcase />}
          />
          <OpsStatCard
            label="New customers"
            value={totals.newCustomers.toLocaleString('en-IN')}
            deltaPct={customersDelta.pct}
            caption={caption}
            icon={<UserPlus />}
          />
          <OpsStatCard
            label="Fill rate"
            value={`${(totals.fillRateBps / 100).toFixed(1)}%`}
            deltaPct={periodDelta(summaryDays.map((d) => d.fillRateBps)).pct}
            caption={caption}
            icon={<Gauge />}
          />
          <OpsStatCard
            label="Avg order value"
            value={formatPaiseINR(totals.aovPaise)}
            deltaPct={periodDelta(summaryDays.map((d) => d.aovPaise)).pct}
            caption={caption}
            icon={<TrendingDown />}
          />
        </div>
      </div>

      {/* Row 2 — growth curve + revenue mix donut. */}
      <div className="grid gap-4 md:gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <BookingsGrowthCard points={toGrowthPoints(summaryDays)} />
        </div>
        <BandMixCard slices={toBandSlices(bands)} totalPaid={totals.bookingsPaid} />
      </div>

      {/* Row 3 — live rail + activity. */}
      <div className="grid gap-4 md:gap-5 xl:grid-cols-3">
        <LiveNowCard kpis={kpis} />
        <div className="xl:col-span-2">
          <ActivityFeed activity={activity} />
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton(): React.ReactNode {
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="grid gap-4 md:gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 xl:col-span-2" />
        <div className="grid gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 xl:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function KpiTiles({ kpis }: { kpis: AdminOpsKpis }): React.ReactNode {
  return (
    <>
      <KpiCard
        label="Active rides"
        value={String(kpis.activeRides)}
        hint={`${kpis.searching} searching now`}
      />
      <KpiCard
        label="Online drivers"
        value={String(kpis.onlineDrivers)}
        hint={
          kpis.dispatchableNow === null
            ? 'Dispatchable now: —'
            : `${kpis.dispatchableNow} dispatchable now`
        }
      />
      <KpiCard
        label="Today's GMV"
        value={formatPaise(kpis.todayGmvPaise)}
        hint="Paid bookings, IST day"
      />
      <KpiCard
        label="Today's commission"
        value={formatPaise(kpis.todayCommissionPaise)}
        hint="Commission on paid bookings"
      />
      <KpiCard
        label="Pending approvals"
        value={String(kpis.pendingKyc + kpis.pendingPayouts)}
        hint={`KYC ${kpis.pendingKyc} · Payouts ${kpis.pendingPayouts}`}
      />
      <KpiCard
        label="Fill rate"
        value={kpis.fillRatePct === null ? '—' : `${kpis.fillRatePct}%`}
        hint="Matched ÷ resolved today"
      />
      <KpiCard
        label="Time to match"
        value={kpis.timeToMatchP50Seconds === null ? '—' : `${kpis.timeToMatchP50Seconds}s`}
        hint={kpis.timeToMatchP90Seconds === null ? 'p90 —' : `p90 ${kpis.timeToMatchP90Seconds}s`}
      />
      <KpiCard
        label="Needs attention"
        value={String(kpis.completedUnpaid)}
        hint={`${kpis.cancelledToday} cancelled today`}
      />
      <KpiCard
        label="SOS"
        value={String(kpis.sos.open)}
        hint={
          kpis.sos.ackP50Seconds === null
            ? 'Ack time: — (none acknowledged)'
            : `Ack p50 ${kpis.sos.ackP50Seconds}s · p95 ${kpis.sos.ackP95Seconds ?? '—'}s`
        }
      />
    </>
  );
}
