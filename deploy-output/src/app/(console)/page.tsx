'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, Info, OctagonAlert } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Skeleton } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useDashboardSummary } from '@/features/dashboard/api/dashboard.queries';
import { DashboardMiniMap } from '@/features/realtime/components/DashboardMiniMap';
import type { FleetAlert } from '@/features/dashboard/types';
import { formatPaise } from '@/lib/money';

const severityIcon: Record<FleetAlert['severity'], React.ReactNode> = {
  error: <OctagonAlert className="size-4 text-error" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  info: <Info className="size-4 text-info" />,
};

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        {hint ? <p className="mt-1 text-xs text-text-tertiary">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboardSummary();

  return (
    <div>
      <PageHeader title="Dashboard" description="Fleet health at a glance — live KPIs arrive with the realtime phase." />

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)
            ) : (
              <>
                <KpiCard
                  label="Active trucks"
                  value={`${data.kpis.activeTrucks}/${data.kpis.totalTrucks}`}
                  hint="Compliant and dispatchable"
                />
                <KpiCard label="Jobs today" value={String(data.kpis.jobsToday)} />
                <KpiCard
                  label="Revenue today"
                  value={formatPaise(data.kpis.revenueTodayPaise)}
                  hint="Fleet share after commission"
                />
                <KpiCard label="Utilization" value={`${data.kpis.utilizationPct}%`} hint="Trucks on jobs, trailing 24h" />
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Alerts</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {isLoading || !data ? (
                  Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)
                ) : data.alerts.length === 0 ? (
                  <EmptyState title="No alerts" description="Compliance and payouts are all clear." />
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
