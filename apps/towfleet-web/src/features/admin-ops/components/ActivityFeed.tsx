'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { AdminActivityItem, AdminOpsActivityResponse } from '@towing/api-contracts';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  RelativeTime,
  Skeleton,
} from '@towing/web-ui';

/**
 * §9.4.2's live activity feed.
 *
 * Rows arrive from the REST feed (the Redis list with its DB backfill) and are
 * refreshed — debounced, in the realtime provider — when booking frames land,
 * so the list stays live without a socket event per row. The `backfilled`
 * badge is the honesty flag: a backfilled feed is reconstructed from history
 * and cannot show creations the live list never saw.
 */
export function ActivityFeed({
  activity,
}: {
  activity: UseQueryResult<AdminOpsActivityResponse>;
}): React.ReactNode {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Live activity</CardTitle>
          {activity.data?.backfilled ? (
            <Badge variant="warning" title="The live list was empty — rows reconstructed from history">
              Backfilled
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {activity.isLoading || !activity.data ? (
          Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-10" />)
        ) : activity.data.items.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Marketplace events appear here as they happen."
          />
        ) : (
          activity.data.items.map((item) => (
            <div
              key={item.id}
              data-testid="admin-activity-item"
              className="flex items-center gap-3 rounded-input px-2 py-2.5"
            >
              <span className="flex-1 text-sm">{activityLabel(item)}</span>
              <RelativeTime at={item.at} className="text-xs text-text-tertiary" />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function activityLabel(item: AdminActivityItem): string {
  if (item.kind === 'booking_created') {
    return item.scheduledAt
      ? `Booking ${shortId(item.bookingId)} scheduled`
      : `New booking ${shortId(item.bookingId)} — searching`;
  }
  if (item.kind === 'booking_status') {
    return `Booking ${shortId(item.bookingId)} → ${item.status ?? 'updated'}`;
  }
  return `${item.action ?? 'Admin action'}${item.subjectType ? ` (${item.subjectType})` : ''}`;
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '—';
}
