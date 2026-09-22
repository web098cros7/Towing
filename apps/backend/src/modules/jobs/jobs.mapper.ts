import { rupeeStringToPaise, type JobDto } from '@towing/api-contracts';
import type { JobFeedRow } from './jobs.repo';

const SERVICE_LABEL: Record<string, string> = {
  tow: 'Tow',
  battery: 'Battery jumpstart',
  flat_tyre: 'Flat-tyre assist',
  fuel: 'Fuel delivery',
  breakdown: 'Breakdown assistance',
  accident_recovery: 'Accident recovery',
  lockout: 'Car lockout',
};

export function toJobDto(row: JobFeedRow): JobDto {
  const b = row.booking;
  return {
    id: b.id,
    // Display-only; bookings have no human code column yet.
    code: `TW-${b.id.slice(0, 8).toUpperCase()}`,
    serviceType: SERVICE_LABEL[b.serviceType] ?? b.serviceType,
    status: b.status,
    driverName: row.driverName,
    // The driver's CURRENT truck — an approximation for historical jobs.
    truckPlate: row.truckPlate,
    pickupArea: b.pickupAddress ?? '—',
    dropArea: b.dropAddress,
    distanceKm: b.distanceKm === null ? 0 : Number(b.distanceKm),
    grossPaise: Math.max(0, rupeeStringToPaise(b.total)),
    commissionBand: b.commissionBand,
    commissionPct: b.commissionPct === null ? null : Number(b.commissionPct),
    commissionPaise: rupeeStringToPaise(b.commissionAmount),
    poolPaise: rupeeStringToPaise(b.driverPayout),
    createdAt: b.createdAt.toISOString(),
  };
}
