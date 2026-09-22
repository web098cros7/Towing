'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card } from '@towing/web-ui';
import { cn } from '@towing/web-ui';
import { formatDeltaPct } from '../lib/dashboardRange';

/**
 * Dashboard v2 stat card (NextAdmin SaaS grade): label + icon header, big
 * tabular value, delta pill vs the prior half-period, muted caption.
 *
 * `invert` marks metrics where down is good (churn, cancellations) so the
 * pill stays honest — a falling churn rate renders green.
 */
export function OpsStatCard({
  label,
  value,
  deltaPct,
  invert = false,
  caption,
  icon,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  invert?: boolean;
  caption: string;
  icon: React.ReactNode;
}): React.ReactNode {
  const good = deltaPct === null ? null : invert ? deltaPct < 0 : deltaPct >= 0;
  const Icon = deltaPct === null ? Minus : deltaPct >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="p-4 transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-text-secondary">{label}</p>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-input bg-surface1 text-text-tertiary [&_svg]:size-4">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-[26px] font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        {deltaPct === null ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-surface1 px-1.5 py-0.5 font-semibold text-text-tertiary tabular-nums">
            <Icon className="size-3.5" /> —
          </span>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums',
              good ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
            )}
          >
            <Icon className="size-3.5" />
            {formatDeltaPct(deltaPct)}
          </span>
        )}
        <span className="text-text-tertiary">{caption}</span>
      </p>
    </Card>
  );
}
