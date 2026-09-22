'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@towing/web-ui';
import { useAdminPayoutSla } from '../api/adminFinance.queries';

/**
 * §14.4's payout SLA — how long DECISIONS take, which is the number Finance
 * actually owns. The vendor's payout latency is a different metric with a
 * different owner, and merging the two is how a queue problem gets blamed on a
 * bank.
 *
 * `pendingOver24h` is the row that should page somebody: decisions can be slow
 * for a week and cost nothing, while a payout nobody has LOOKED at is the
 * failure the SLA exists to catch.
 */
export function PayoutSlaCard() {
  const { data, isLoading, isError } = useAdminPayoutSla(30);

  const stats = [
    {
      label: 'Median decision',
      value: data?.p50Minutes != null ? `${data.p50Minutes} min` : '—',
    },
    { label: 'p95 decision', value: data?.p95Minutes != null ? `${data.p95Minutes} min` : '—' },
    { label: 'Decided (30 d)', value: data ? String(data.decided) : '—' },
    { label: 'Breaches > 24 h', value: data ? String(data.breaches24h) : '—' },
    {
      label: 'Waiting > 24 h now',
      value: data ? String(data.pendingOver24h) : '—',
      alarm: (data?.pendingOver24h ?? 0) > 0,
    },
  ];

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Payout decision SLA (30 days)</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isError ? (
          <p className="text-sm text-error">Could not load the SLA.</p>
        ) : isLoading || !data ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="payout-sla">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {stat.label}
                </dt>
                <dd
                  className={
                    stat.alarm
                      ? 'mt-1 text-lg font-bold tabular-nums text-error'
                      : 'mt-1 text-lg font-bold tabular-nums'
                  }
                >
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-xs text-text-tertiary">
          Decision latency is requested → approved or rejected. The vendor&apos;s bank leg is a
          separate clock and is not what this measures.
        </p>
      </CardContent>
    </Card>
  );
}
