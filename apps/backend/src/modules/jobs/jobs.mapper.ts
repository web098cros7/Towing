import {
  rupeeStringToPaise,
  type JobActor,
  type JobDetail,
  type JobDto,
  type JobStatus,
} from '@towing/api-contracts';
import type { JobDetailRows, JobFeedRow } from './jobs.repo';

const SERVICE_LABEL: Record<string, string> = {
  tow: 'Tow',
  battery: 'Battery jumpstart',
  flat_tyre: 'Flat-tyre assist',
  fuel: 'Fuel delivery',
  breakdown: 'Breakdown assistance',
  accident_recovery: 'Accident recovery',
  lockout: 'Car lockout',
  winch_out: 'Winch out',
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

/** A history row's actor, as a fleet may see it: an admin is "MiTow", never a name. */
function toActor(actor: string): JobActor {
  switch (actor) {
    case 'customer':
    case 'driver':
    case 'fleet_owner':
    case 'system':
      return actor;
    default:
      return 'mitow';
  }
}

const paise = (rupees: string): number => rupeeStringToPaise(rupees);

export function toJobDetail(rows: JobDetailRows): JobDetail {
  const b = rows.booking;
  const sum = (predicate: (leg: JobDetailRows['ledger'][number]) => boolean): number =>
    rows.ledger.filter(predicate).reduce((total, leg) => total + leg.amountPaise, 0);

  const fleetCredit = sum((leg) => leg.ownerType === 'fleet' && leg.type !== 'refund_debit');
  const driverCredit = sum((leg) => leg.ownerType === 'driver' && leg.type !== 'refund_debit');
  const settled = rows.ledger.some((leg) => leg.type !== 'refund_debit');
  // Clawbacks are negative legs; the fleet sees them as a positive "taken back".
  const refundedPaise = -sum((leg) => leg.type === 'refund_debit');

  const cancelled = b.status === 'cancelled';

  return {
    ...toJobDto(rows),
    truckPlate: rows.jobTruckPlate ?? rows.truckPlate,
    pickupAddress: b.pickupAddress,
    dropAddress: b.dropAddress,
    paymentMethod: b.paymentMethod,
    fare: {
      basePaise: paise(b.baseFare),
      distancePaise: paise(b.distanceCharge),
      nightPaise: paise(b.nightCharge),
      highwayPaise: paise(b.highwayCharge),
      accidentPaise: paise(b.accidentCharge),
      waitingPaise: paise(b.waitingCharge),
      surgePaise: paise(b.surgeAmount),
      discountPaise: paise(b.discount),
      taxPaise: paise(b.taxAmount),
      totalPaise: paise(b.total),
    },
    split: {
      settled,
      commissionPaise: paise(b.commissionAmount),
      fleetSharePaise: settled ? fleetCredit : null,
      driverSharePaise: settled ? driverCredit : null,
      refundedPaise,
    },
    cancellation: cancelled
      ? {
          by: b.cancelledBy ? toActor(b.cancelledBy) : null,
          reason: b.cancellationReason,
          feePaise: paise(b.cancellationFee),
          driverCompensationPaise: paise(b.driverCompensation),
        }
      : null,
    timeline: rows.history.map((entry) => ({
      status: entry.status as JobStatus,
      actor: toActor(entry.actor),
      at: entry.createdAt.toISOString(),
    })),
  };
}
