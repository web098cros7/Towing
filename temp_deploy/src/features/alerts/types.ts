import type { FleetAlert } from '@/features/dashboard/types';

/**
 * The alerts feed reuses the dashboard's alert shape — since Phase 6 they are
 * literally the same stored rows, and a second definition would be the thing
 * that change was meant to end.
 */
export type StoredAlert = FleetAlert & {
  /** Null while the alert is open; set once the underlying problem is fixed. */
  resolvedAt: string | null;
};

export type AlertSeverity = FleetAlert['severity'];

export type AlertsFilter = {
  severity?: AlertSeverity;
  includeResolved: boolean;
};

export const ALERT_TYPE_LABEL: Record<FleetAlert['type'], string> = {
  doc_expiring: 'Document expiring',
  doc_expired: 'Document expired',
  truck_idle: 'Truck idle',
  payout_failed: 'Payout failed',
};

/** What a re-check changed, for the confirmation toast. */
export type RecheckResult = {
  expired: number;
  expiringSoon: number;
  trucksBlocked: number;
  trucksCleared: number;
  alertsOpened: number;
  alertsResolved: number;
};
