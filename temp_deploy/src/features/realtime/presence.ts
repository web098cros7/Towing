import { PRESENCE_OFFLINE_MS, PRESENCE_STALE_MS, presenceFor } from '@towing/api-contracts';

/**
 * Re-exported from the shared contract so a marker can never grey at one age in
 * the browser and another on the server (§11.6). Do not redefine the thresholds
 * here.
 */
export { PRESENCE_OFFLINE_MS, PRESENCE_STALE_MS, presenceFor };
export type Presence = ReturnType<typeof presenceFor>;

export type TruckStatus = 'active' | 'inactive' | 'non_compliant';

/** Age in whole seconds, for the "last seen 42s ago" line in the side panel. */
export function ageSeconds(at: string | null, nowMs: number): number | null {
  if (at === null) return null;
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((nowMs - parsed) / 1000));
}

export function presenceLabel(presence: Presence): string {
  if (presence === 'live') return 'Live';
  if (presence === 'stale') return 'Reconnecting…';
  return 'Offline';
}
