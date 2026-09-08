'use client';

import { cn } from '@towing/web-ui';
import type { FleetPosition, FleetZone, MapStatusFilter } from '../types';

/** §9.3.3 "filters (status, driver, zone)". */
export interface MapFilterState {
  status: MapStatusFilter;
  driverName: string;
  zoneId: string;
}

export const EMPTY_FILTERS: MapFilterState = { status: 'all', driverName: '', zoneId: '' };

const STATUS_OPTIONS: Array<{ value: MapStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'on_job', label: 'On job' },
  { value: 'active', label: 'Idle' },
  { value: 'non_compliant', label: 'Non-compliant' },
  { value: 'inactive', label: 'Inactive' },
];

export function MapFilters({
  value,
  onChange,
  positions,
  zones,
}: {
  value: MapFilterState;
  onChange: (next: MapFilterState) => void;
  positions: FleetPosition[];
  zones: FleetZone[];
}) {
  const drivers = [...new Set(positions.map((p) => p.driverName).filter((n): n is string => !!n))]
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="map-filters">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value.status === option.value}
            onClick={() => onChange({ ...value, status: option.value })}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
              value.status === option.value
                ? 'border-brand bg-brand-tint text-brand'
                : 'border-border text-text-secondary hover:bg-surface1',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <select
        aria-label="Filter by driver"
        value={value.driverName}
        onChange={(event) => onChange({ ...value, driverName: event.target.value })}
        className="rounded-input border border-border bg-card px-2 py-1 text-xs text-text-primary"
      >
        <option value="">All drivers</option>
        {drivers.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {/* Zones come from the same snapshot that draws them on the map, so this
          list is never out of step with what the operator can see. */}
      <select
        aria-label="Filter by zone"
        value={value.zoneId}
        onChange={(event) => onChange({ ...value, zoneId: event.target.value })}
        className="rounded-input border border-border bg-card px-2 py-1 text-xs text-text-primary"
        disabled={zones.length === 0}
      >
        <option value="">All zones</option>
        {zones.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.name}
          </option>
        ))}
      </select>
    </div>
  );
}
