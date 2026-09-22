'use client';

import type { AdminZone, AdminZonesResponse } from '@towing/api-contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@towing/web-ui';

/**
 * The zone rail: every service area, in the order the resolver considers them.
 *
 * The LIST ORDER IS NOT ALPHABETICAL — it is the resolution order the API sends
 * (`highway first, then smallest area`), because the question an operator has
 * while looking at two overlapping boxes is "which one wins", and the list is
 * where they find that out before drawing anything.
 */
export function ZoneList({
  data,
  loading,
  selectedZoneId,
  creating,
  onSelect,
  onNew,
}: {
  data: AdminZonesResponse | undefined;
  loading: boolean;
  selectedZoneId: string | null;
  creating: boolean;
  onSelect: (zoneId: string) => void;
  onNew: () => void;
}) {
  const zones = data?.items ?? [];

  /** The API's resolution order decides the display order (highway, then area). */
  const ordered: AdminZone[] = [...zones].sort((a, b) => {
    if (a.isHighway !== b.isHighway) return a.isHighway ? -1 : 1;
    return a.areaKm2 - b.areaKm2;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Service areas</CardTitle>
        <Button
          size="sm"
          variant={creating ? 'primary' : 'secondary'}
          onClick={onNew}
          data-testid="zone-new"
        >
          Draw new
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : ordered.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No service areas yet — nothing is priced or dispatchable anywhere.
          </p>
        ) : (
          ordered.map((zone) => (
            <button
              key={zone.id}
              type="button"
              onClick={() => onSelect(zone.id)}
              aria-current={zone.id === selectedZoneId}
              className={`w-full rounded-card border px-3 py-2 text-left transition-colors ${
                zone.id === selectedZoneId
                  ? 'border-brand bg-brand/5'
                  : 'border-border hover:bg-surface'
              }`}
              data-testid={`zone-row-${zone.code}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{zone.name}</span>
                <Badge variant={zone.isActive ? 'success' : 'neutral'}>
                  {zone.isActive ? 'Live' : 'Paused'}
                </Badge>
              </span>
              <span className="mt-1 block text-xs text-text-secondary">
                <span data-testid={`zone-state-${zone.code}`}>
                  {zone.isActive ? 'Live' : 'Paused'}
                </span>
                {' · '}
                {zone.code}
                {' · '}
                {zone.areaKm2.toFixed(1)} km²
                {' · '}v{zone.version}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <Badge variant="neutral">{zone.surgeBand}</Badge>
                {zone.isHighway ? <Badge variant="warning">highway</Badge> : null}
                {zone.dispatchConfig ? (
                  <Badge variant="info" data-testid={`zone-tuned-${zone.code}`}>
                    tuned
                  </Badge>
                ) : null}
              </span>
            </button>
          ))
        )}

        {data ? (
          <div className="border-t border-border pt-2">
            <p className="text-xs font-semibold text-text-secondary">How an overlap resolves</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-text-tertiary">
              {data.resolution.map((line) => (
                <li key={line}>{line.replace(/^\d+\.\s*/, '')}</li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
