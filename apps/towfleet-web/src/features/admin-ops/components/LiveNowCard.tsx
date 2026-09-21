'use client';

import Link from 'next/link';
import { Activity, ArrowRight, Car, FileSearch, ShieldAlert, Wallet, type LucideIcon } from 'lucide-react';
import type { AdminOpsKpis } from '@towing/api-contracts';
import { Card } from '@towing/web-ui';
import { useAdminRealtime } from '@/features/admin-realtime/AdminRealtimeProvider';

/**
 * Dashboard v2 "Live now" rail — the socket-patched KPIs as compact rows,
 * so the trend dashboard never loses the "what needs me THIS minute" view.
 * Numbers arrive via `ops:metrics` frames (patched into the query cache);
 * polling every 10 s covers socket outages.
 */
export function LiveNowCard({ kpis }: { kpis: AdminOpsKpis }): React.ReactNode {
  const { mode } = useAdminRealtime();
  const live = mode === 'live';

  const rows: Array<{ icon: LucideIcon; label: string; value: string; sub: string; tone?: string }> = [
    {
      icon: Activity,
      label: 'Active rides',
      value: String(kpis.activeRides),
      sub: `${kpis.searching} searching`,
      tone: kpis.searching > 0 ? 'text-warning' : undefined,
    },
    {
      icon: Car,
      label: 'Online drivers',
      value: String(kpis.onlineDrivers),
      sub:
        kpis.dispatchableNow === null
          ? 'Dispatchable: —'
          : `${kpis.dispatchableNow} dispatchable`,
    },
    {
      icon: FileSearch,
      label: 'Pending approvals',
      value: String(kpis.pendingKyc + kpis.pendingPayouts),
      sub: `KYC ${kpis.pendingKyc} · Payouts ${kpis.pendingPayouts}`,
      tone: kpis.pendingKyc + kpis.pendingPayouts > 0 ? 'text-warning' : undefined,
    },
    {
      icon: Wallet,
      label: 'Completed, unpaid',
      value: String(kpis.completedUnpaid),
      sub: `${kpis.cancelledToday} cancelled today`,
      tone: kpis.completedUnpaid > 0 ? 'text-error' : undefined,
    },
    {
      icon: ShieldAlert,
      label: 'Open SOS',
      value: String(kpis.sos.open),
      sub:
        kpis.sos.ackP50Seconds === null
          ? 'No acks yet'
          : `Ack p50 ${kpis.sos.ackP50Seconds}s`,
      tone: kpis.sos.open > 0 ? 'text-error' : undefined,
    },
  ];

  return (
    <Card className="flex flex-col p-4 md:p-5" data-testid="live-now">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Live now</h3>
        <span
          className="flex items-center gap-1.5 text-xs font-medium text-text-secondary"
          title={live ? 'Realtime connected' : 'REST polling fallback'}
        >
          <span className="relative flex size-2">
            {live ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            ) : null}
            <span
              className={`relative inline-flex size-2 rounded-full ${live ? 'bg-success' : 'bg-warning'}`}
            />
          </span>
          {live ? 'Live' : 'Polling'}
        </span>
      </div>
      <ul className="flex flex-1 flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-input bg-surface1 text-text-secondary [&_svg]:size-4">
              <row.icon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{row.label}</span>
              <span className="block truncate text-xs text-text-tertiary">{row.sub}</span>
            </span>
            <span className={`text-lg font-bold tabular-nums ${row.tone ?? ''}`}>
              {row.value}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/admin/ops"
        className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline"
      >
        Open Live Ops <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}
