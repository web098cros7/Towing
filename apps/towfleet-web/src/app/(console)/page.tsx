'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Briefcase, Car, Gauge, Info, OctagonAlert, Wallet } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  KpiCard,
  Select,
  Skeleton,
} from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useDashboardSummary } from '@/features/dashboard/api/dashboard.queries';
import { FleetEarningsHero } from '@/features/dashboard/components/FleetEarningsHero';
import { DashboardMiniMap } from '@/features/realtime/components/DashboardMiniMap';
import type { FleetAlert } from '@/features/dashboard/types';
import { formatPaise } from '@/lib/money';
import { addDays, istToday } from '@/features/admin-ops/lib/dashboardRange';

const severityIcon: Record<FleetAlert['severity'], React.ReactNode> = {
  error: <OctagonAlert className="size-4 text-error" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  info: <Info className="size-4 text-info" />,
};

const RANGE_OPTIONS = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
] as const;

/**
 * Fleet dashboard — earnings hero with range + delta, KPI tiles with icons,
 * then the alerts queue and live mini-map. The hero reads the fleet
 * `earnings_daily` projection (settled money only); the tiles stay
 * today-scoped from the dashboard summary.
 */
export default function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboardSummary();
  const [rangeDays, setRangeDays] = useState<number>(30);
  const range = useMemo(
    () => ({ from: addDays(istToday(), -(rangeDays - 1)), to: istToday() }),
    [rangeDays],
  );
  const rangeLabel = RANGE_OPTIONS.find((r) => r.days === rangeDays)?.label ?? `${rangeDays}D`;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Fleet health at a glance — earnings trend plus today's live KPIs."
        actions={
          <Select
            aria-label="Earnings range"
            data-testid="fleet-range"
            className="h-9 w-24"
            value={String(rangeDays)}
            onChange={(e) => setRangeDays(Number(e.target.value))}
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.days} value={String(r.days)}>
                {r.label}
              </option>
            ))}
          </Select>
        }
      />

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <div className="flex flex-col gap-4 md:gap-5">
          <div className="grid gap-4 md:gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <FleetEarningsHero range={range} rangeLabel={rangeLabel} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-2">
              {isLoading || !data ? (
                Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
              ) : (
                <>
                  <KpiCard
                    label="Active trucks"
                    value={`${data.kpis.activeTrucks}/${data.kpis.totalTrucks}`}
                    hint="Compliant and dispatchable"
                    icon={<Car />}
                  />
                  <KpiCard
                    label="Jobs today"
                    value={String(data.kpis.jobsToday)}
                    icon={<Briefcase />}
                  />
                  <KpiCard
                    label="Revenue today"
                    value={formatPaise(data.kpis.revenueTodayPaise)}
                    hint="Fleet share after commission"
                    icon={<Wallet />}
                    tone="brand"
                  />
                  <KpiCard
                    label="Utilization"
                    value={`${data.kpis.utilizationPct}%`}
                    hint="Trucks on jobs, trailing 24h"
                    icon={<Gauge />}
                  />
                </>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Alerts</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {isLoading || !data ? (
                  Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)
                ) : data.alerts.length === 0 ? (
                  <EmptyState
                    title="No alerts"
                    description="Compliance and payouts are all clear."
                  />
                ) : (
                  data.alerts.map((alert) => (
                    <Link
                      key={alert.id}
                      href={alert.href}
                      className="flex items-center gap-3 rounded-input px-2 py-2.5 transition-colors hover:bg-surface1"
                    >
                      {severityIcon[alert.severity]}
                      <span className="flex-1 text-sm">{alert.message}</span>
                      <ArrowRight className="size-4 text-text-tertiary" />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <DashboardMiniMap />
          </div>
        </div>
      )}
    </div>
  );
}
