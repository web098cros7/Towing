'use client';

import { cn, Switch } from '@towing/web-ui';
import type { FleetZone } from '@/features/realtime/types';

/**
 * W4's map filters (§9.4.6 "filter by zone/status").
 *
 * Zone is a ROOM JOIN as well as a query param — changing it reshapes what the
 * socket pushes (the relay routes position groups per zone), and refetches the
 * REST snapshot with the same narrowing so the two cannot disagree. Status
 * narrows bookings only (drivers have no job status); "stale only" is the
 * operator's tool for finding drivers whose tracking has gone quiet.
 *
 * The pill markup mirrors the fleet `MapFilters`, including the A2 token rule:
 * an active filter is `bg-brand-tint text-brand`.
 */
export interface AdminMapFilterState {
  status: 'all' | 'assigned' | 'en_route' | 'arrived' | 'in_progress';
  /** Empty string = every zone. */
  zoneId: string;
  staleOnly: boolean;
}

export const EMPTY_ADMIN_FILTERS: AdminMapFilterState = {
  status: 'all',
  zoneId: '',
  staleOnly: false,
};

const STATUS_OPTIONS: Array<{ value: AdminMapFilterState['status']; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'en_route', label: 'En route' },
  { value: 'arrived', label: 'Arrived' },
  { value: 'in_progress', label: 'In progress' },
];

export function AdminMapFilters({
  value,
  onChange,
  zones,
}: {
  value: AdminMapFilterState;
  onChange: (next: AdminMapFilterState) => void;
  zones: FleetZone[];
}): React.ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="admin-map-filters">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter bookings by status">
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

      {/* Zones come from the same snapshot the map draws, so the list is never
          out of step with what the operator can see. */}
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

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <Switch
          checked={value.staleOnly}
          onCheckedChange={(checked) => onChange({ ...value, staleOnly: checked })}
        />
        Stale only
      </label>
    </div>
  );
}
