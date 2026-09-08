'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@towing/web-ui';
import { useFleetPositions } from '../api/realtime.queries';
import { useRealtime } from '../RealtimeProvider';
import { FleetMap } from './FleetMap';

/**
 * The dashboard's "Live fleet" card. Same `<FleetMap>` seam as `/map`, in its
 * `mini` variant — no controls, no side panel, no filters — with the "Open live
 * map" affordance the placeholder had.
 */
export function DashboardMiniMap() {
  const { mode } = useRealtime();
  const { data, isLoading } = useFleetPositions(mode);

  const positions = data?.positions ?? [];
  const moving = positions.filter((p) => p.lat !== null && p.lng !== null).length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Live fleet</CardTitle>
        <Link href="/map" className="text-sm font-semibold text-brand hover:underline">
          Open live map →
        </Link>
      </CardHeader>
      <CardContent>
        {/* h-64 preserved from the placeholder so the dashboard grid does not
            reflow when the map replaces it. */}
        <div className="h-64 overflow-hidden rounded-input">
          {isLoading && positions.length === 0 ? (
            <Skeleton className="h-64 w-full rounded-input" />
          ) : (
            <FleetMap positions={positions} zones={data?.zones ?? []} variant="mini" />
          )}
        </div>
        <p className="mt-2 text-xs text-text-tertiary">
          {moving} of {positions.length} trucks reporting a position
        </p>
      </CardContent>
    </Card>
  );
}
