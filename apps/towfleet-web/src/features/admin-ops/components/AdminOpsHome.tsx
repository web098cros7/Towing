'use client';

import type { AdminOpsKpis } from '@towing/api-contracts';
import { Badge, ErrorState, KpiCard, Skeleton } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminRealtime } from '@/features/admin-realtime/AdminRealtimeProvider';
import { formatPaise } from '@/lib/money';
import { useAdminOpsActivity, useAdminOpsDashboard } from '../api/adminOps.queries';
import { ActivityFeed } from './ActivityFeed';

/**
 * §9.4.2's ops dashboard — the `/admin` landing for every `ops.live` holder.
 *
 * Freshness is push-first: `ops:metrics` frames patch the cached dashboard in
 * the realtime provider, and the query falls back to 10 s polling only while
 * the transport itself is down. Numbers are formatted from the same contract
 * types the backend e2e asserts exactly against a hand-built day.
 */
export function AdminOpsHome(): React.ReactNode {
  const { mode } = useAdminRealtime();
  const dashboard = useAdminOpsDashboard(true, mode);
  const activity = useAdminOpsActivity(true, mode);

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Marketplace health, live — pushed over the admin socket."
      />

      {dashboard.isError ? (
        <ErrorState onRetry={() => void dashboard.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {dashboard.isLoading || !dashboard.data ? (
              Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-28" />)
            ) : (
              <KpiTiles kpis={dashboard.data.kpis} />
            )}
          </div>

          {dashboard.data?.degraded ? (
            <div>
              <Badge variant="warning" title="Redis unavailable — served from Postgres">
                Degraded: dispatchable-now count unavailable
              </Badge>
            </div>
          ) : null}

          <ActivityFeed activity={activity} />
        </div>
      )}
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
