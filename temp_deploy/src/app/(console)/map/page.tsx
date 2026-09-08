'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardContent, ErrorState, Skeleton } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useFleetPositions } from '@/features/realtime/api/realtime.queries';
import { FleetMap } from '@/features/realtime/components/FleetMap';
import {
  EMPTY_FILTERS,
  MapFilters,
  type MapFilterState,
} from '@/features/realtime/components/MapFilters';
import { TruckSidePanel } from '@/features/realtime/components/TruckSidePanel';
import { matchesFilter } from '@/features/realtime/lib/markerLayers';
import { pointInZone } from '@/features/realtime/lib/pointInZone';
import { ageSeconds, presenceFor, presenceLabel } from '@/features/realtime/presence';
import { useRealtime } from '@/features/realtime/RealtimeProvider';
import type { FleetPosition } from '@/features/realtime/types';

const presenceVariant = { live: 'success', stale: 'warning', offline: 'neutral' } as const;

const statusVariant = {
  active: 'success',
  inactive: 'neutral',
  non_compliant: 'error',
} as const;

function railLabel(position: FleetPosition): string {
  if (position.activeBookingId) return 'On job';
  if (position.status === 'active') return 'Idle';
  return position.status === 'inactive' ? 'Inactive' : 'Non-compliant';
}

/**
 * Live fleet map (§9.3.3). Positions arrive over the socket within 2s of a ping
 * and are interpolated so markers glide rather than teleport (§11.4).
 */
export default function LiveMapPage() {
  const { mode } = useRealtime();
  const { data, isLoading, isError, refetch } = useFleetPositions(mode);
  const [filters, setFilters] = useState<MapFilterState>(EMPTY_FILTERS);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);

  // Presence is an age, so it changes with the clock and not just with data.
  // Without this tick a stalled fleet would keep reading "Live" forever.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const positions = useMemo(() => data?.positions ?? [], [data]);
  const zones = useMemo(() => data?.zones ?? [], [data]);

  const visible = useMemo(() => {
    const zone = filters.zoneId ? zones.find((z) => z.id === filters.zoneId) : undefined;
    return positions.filter((position) => {
      if (!matchesFilter(position, filters.status)) return false;
      if (filters.driverName && position.driverName !== filters.driverName) return false;
      if (zone) {
        if (position.lat === null || position.lng === null) return false;
        if (!pointInZone(position.lng, position.lat, zone)) return false;
      }
      return true;
    });
  }, [positions, zones, filters]);

  const selected = visible.find((p) => p.truckId === selectedTruckId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Live Map"
        description="Truck positions stream within 2 seconds of driver pings."
      />

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <MapFilters value={filters} onChange={setFilters} positions={positions} zones={zones} />
            {data?.degraded ? (
              // §19.2: Redis is down and these came from PostGIS. Say so rather
              // than presenting up-to-10s-old positions as live.
              <Badge variant="warning" title="Redis unavailable — positions served from the database">
                Last known positions
              </Badge>
            ) : null}
          </div>

          <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_280px]">
            <Card className="min-h-[480px]">
              <CardContent className="h-full p-0">
                <div className="h-full min-h-[480px]">
                  {isLoading && positions.length === 0 ? (
                    <Skeleton className="h-full min-h-[480px] w-full rounded-card" />
                  ) : (
                    <FleetMap
                      positions={visible}
                      zones={zones}
                      variant="full"
                      selectedTruckId={selectedTruckId}
                      onSelectTruck={setSelectedTruckId}
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Fleet ({visible.length})
              </h2>
              {isLoading && positions.length === 0
                ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14" />)
                : visible.map((position) => (
                    <TruckRailCard
                      key={position.truckId}
                      position={position}
                      nowMs={nowMs}
                      selected={position.truckId === selectedTruckId}
                      onSelect={() => setSelectedTruckId(position.truckId)}
                    />
                  ))}
            </div>
          </div>
        </>
      )}

      {selected ? (
        <TruckSidePanel position={selected} nowMs={nowMs} onClose={() => setSelectedTruckId(null)} />
      ) : null}
    </div>
  );
}

function TruckRailCard({
  position,
  nowMs,
  selected,
  onSelect,
}: {
  position: FleetPosition;
  nowMs: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const presence = presenceFor(position.at ? Date.parse(position.at) : null, nowMs);
  const age = ageSeconds(position.at, nowMs);

  return (
    <Card className={selected ? 'ring-2 ring-brand' : undefined}>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-center justify-between p-3 text-left"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{position.plate}</div>
            <div className="truncate text-xs text-text-secondary">
              {position.driverName ?? 'Unassigned'}
              {age === null ? '' : ` · ${age < 2 ? 'now' : `${age}s ago`}`}
            </div>
          </div>
          <div className="ml-2 flex shrink-0 flex-col items-end gap-1">
            <Badge variant={statusVariant[position.status]}>{railLabel(position)}</Badge>
            <Badge variant={presenceVariant[presence]}>{presenceLabel(presence)}</Badge>
          </div>
        </button>
      </CardContent>
    </Card>
  );
}
