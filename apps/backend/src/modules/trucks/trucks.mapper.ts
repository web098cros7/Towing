import type { ComplianceDocDto, TruckDto } from '@towing/api-contracts';
import type { ComplianceRow, TruckRow } from './trucks.repo';

const ALL_DOC_TYPES = ['insurance', 'rc', 'puc', 'permit'] as const;

/** DB spells `expiring_soon`; the console spells `expiring`. */
function toClientDocStatus(status: ComplianceRow['status']): ComplianceDocDto['status'] {
  return status === 'expiring_soon' ? 'expiring' : status;
}

function toDocDto(row: ComplianceRow): ComplianceDocDto {
  return {
    id: row.id,
    docType: row.docType,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    status: toClientDocStatus(row.status),
  };
}

/** "5t" / "2.5t" → 5 / 2.5; unparseable/null → 0. */
export function parseCapacityTons(capacity: string | null): number {
  if (!capacity) return 0;
  const parsed = Number.parseFloat(capacity);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toComplianceDtos(truckId: string, docs: ComplianceRow[]): ComplianceDocDto[] {
  const present = docs.filter((d) => d.truckId === truckId).map(toDocDto);
  const presentTypes = new Set(present.map((d) => d.docType));

  // Docs that were never uploaded have no row — the console still shows the
  // full 4-item checklist, so synthesize `missing` entries (§9.3.4).
  const missing: ComplianceDocDto[] = ALL_DOC_TYPES.filter((t) => !presentTypes.has(t)).map(
    (docType) => ({
      id: `${truckId}:${docType}`,
      docType,
      issuedAt: null,
      expiresAt: null,
      status: 'missing',
    }),
  );

  return [...present, ...missing];
}

export function toTruckDto(
  truck: TruckRow,
  docs: ComplianceRow[],
  assignedDriverName: string | null,
): TruckDto {
  return {
    id: truck.id,
    plate: truck.plate,
    type: truck.type,
    make: truck.make,
    model: truck.model,
    capacityTons: parseCapacityTons(truck.capacity),
    status: truck.status,
    assignedDriverName,
    currentLocation: truck.currentLocation,
    lastPingAt: truck.lastPingAt?.toISOString() ?? null,
    compliance: toComplianceDtos(truck.id, docs),
  };
}

/** Doc status from its expiry, mirroring the Phase 6 worker's rule. */
export function docStatusFromExpiry(expiresAt: Date | null, now = new Date()): ComplianceRow['status'] {
  if (!expiresAt) return 'valid';
  if (expiresAt.getTime() < now.getTime()) return 'expired';
  if (expiresAt.getTime() - now.getTime() <= 30 * 86_400_000) return 'expiring_soon';
  return 'valid';
}
