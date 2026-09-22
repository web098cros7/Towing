'use client';

import Link from 'next/link';
import { Card, CardContent, ErrorState, RelativeTime, Skeleton } from '@towing/web-ui';
import { useAdminRealtime } from '@/features/admin-realtime/AdminRealtimeProvider';
import { useAdminDispatchSearches } from '../api/adminOps.queries';

/**
 * W5's live-searches list (§9.4.6) — the inspector's front door.
 *
 * Oldest first (the server sorts), because the longest-waiting search is the
 * one an operator is looking for. A booking whose search has never run still
 * appears — "not started" is a state worth seeing, not a row to hide.
 */
export function AdminDispatchSearches(): React.ReactNode {
  const { mode } = useAdminRealtime();
  const searches = useAdminDispatchSearches(true, mode);

  if (searches.isError) {
    return <ErrorState onRetry={() => void searches.refetch()} />;
  }
  if (searches.isLoading || !searches.data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const items = searches.data.items;
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-text-secondary">
          No live searches right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-4 py-3 font-semibold">Booking</th>
              <th className="px-4 py-3 font-semibold">Service</th>
              <th className="px-4 py-3 font-semibold">Wave</th>
              <th className="px-4 py-3 font-semibold">Contacted</th>
              <th className="px-4 py-3 font-semibold">Deadline</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.bookingId}
                data-testid="admin-dispatch-search"
                className="border-t border-border"
              >
                <td className="px-4 py-3 font-mono text-xs">{item.bookingId.slice(0, 8)}</td>
                <td className="px-4 py-3">
                  {item.serviceType} · {item.vehicleClass}
                </td>
                <td className="px-4 py-3">
                  {item.wave === null ? 'Not started' : `Wave ${item.wave} · ${item.radiusKm} km`}
                </td>
                <td className="px-4 py-3">{item.contacted}</td>
                <td className="px-4 py-3">
                  {item.deadlineAt ? <RelativeTime at={item.deadlineAt} /> : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/ops/dispatch/${item.bookingId}`}
                    className="text-sm text-brand hover:underline"
                  >
                    Inspect
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
