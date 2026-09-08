'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, OctagonAlert, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Skeleton,
  cn,
} from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAlerts, useRecheckCompliance } from '@/features/alerts/api/alerts.queries';
import { ALERT_TYPE_LABEL, type AlertSeverity, type AlertsFilter } from '@/features/alerts/types';

const severityIcon: Record<AlertSeverity, React.ReactNode> = {
  error: <OctagonAlert className="size-4 shrink-0 text-error" />,
  warning: <AlertTriangle className="size-4 shrink-0 text-warning" />,
  info: <Info className="size-4 shrink-0 text-info" />,
};

const severityVariant: Record<AlertSeverity, 'error' | 'warning' | 'info'> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const SEVERITIES: Array<{ value: AlertSeverity | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Errors' },
  { value: 'warning', label: 'Warnings' },
  { value: 'info', label: 'Info' },
];

function relative(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Compliance and payout alerts (§9.3.2, §9.3.4).
 *
 * These are the same stored rows the dashboard's alert card shows — since
 * Phase 6 there is one source, written by the hourly compliance worker.
 */
export default function AlertsPage() {
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all');
  const [includeResolved, setIncludeResolved] = useState(false);

  const filter: AlertsFilter = {
    includeResolved,
    ...(severity === 'all' ? {} : { severity }),
  };
  const { data, isLoading, isError, refetch } = useAlerts(filter);
  const recheck = useRecheckCompliance();

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Compliance and payout issues, refreshed hourly by the compliance worker."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Filter by severity">
            {SEVERITIES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={severity === option.value}
                onClick={() => setSeverity(option.value)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                  severity === option.value
                    ? 'border-brand bg-brand-tint text-brand'
                    : 'border-border text-text-secondary hover:bg-surface1',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(event) => setIncludeResolved(event.target.checked)}
              className="size-3.5 accent-[var(--brand)]"
            />
            Show resolved
          </label>
        </div>

        {/* The alternative is telling an operator who just renewed a document to
            wait up to an hour for the truck to rejoin dispatch. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => recheck.mutate()}
          disabled={recheck.isPending}
        >
          <RefreshCw className={cn('size-4', recheck.isPending && 'animate-spin')} />
          {recheck.isPending ? 'Re-checking…' : 'Re-check now'}
        </Button>
      </div>

      {recheck.isSuccess ? (
        <Card className="mb-4 border-success-soft-bg bg-success-soft-bg/40">
          <CardContent className="p-3 text-sm text-success-soft-fg">
            Re-check complete — {recheck.data.alertsOpened} opened,{' '}
            {recheck.data.alertsResolved} resolved, {recheck.data.trucksBlocked} truck(s) blocked,{' '}
            {recheck.data.trucksCleared} cleared.
          </CardContent>
        </Card>
      ) : null}

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          title="No alerts"
          description={
            includeResolved
              ? 'Nothing has been flagged for this fleet.'
              : 'Compliance and payouts are all clear.'
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((alert) => (
            <Card key={alert.id} className={alert.resolvedAt ? 'opacity-60' : undefined}>
              <CardContent className="flex items-center gap-3 p-3">
                {alert.resolvedAt ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  severityIcon[alert.severity]
                )}

                <div className="min-w-0 flex-1">
                  <div className="text-sm">{alert.message}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-text-tertiary">
                    <span>{ALERT_TYPE_LABEL[alert.type]}</span>
                    <span aria-hidden>·</span>
                    <span>{relative(alert.createdAt)}</span>
                    {alert.resolvedAt ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>resolved {relative(alert.resolvedAt)}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                {alert.resolvedAt ? (
                  <Badge variant="success">Resolved</Badge>
                ) : (
                  <Badge variant={severityVariant[alert.severity]}>{alert.severity}</Badge>
                )}

                <Link
                  href={alert.href}
                  aria-label="Open related record"
                  className="rounded-input p-1 text-text-tertiary transition-colors hover:bg-surface1 hover:text-text-primary"
                >
                  <ArrowRight className="size-4" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
