import type {
  AdminZone,
  AdminZoneCreate,
  AdminZonePreview,
  AdminZonePreviewRequest,
  AdminZoneUpdate,
  AdminZoneVersion,
  AdminZonesResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminZoneMocks, adminZoneVersionsMock, adminZonesMock, approxAreaKm2 } from '../mocks/adminZones.mock';

/**
 * W13's `/admin/zones`.
 *
 * The map owns the DRAWING; this source only ever sees a finished polygon, the
 * same GeoJSON the backend stores. A create writes the shape and a matching
 * version row in one transaction server-side, so there is no "save the shape
 * later" step here either.
 */
export interface AdminZonesDataSource {
  list(): Promise<AdminZonesResponse>;
  create(body: AdminZoneCreate): Promise<AdminZone>;
  update(zoneId: string, body: AdminZoneUpdate): Promise<AdminZone>;
  /** §9.4.8's pause/resume — its own verb because it has its own reconcile. */
  setActive(zoneId: string, active: boolean, reason?: string): Promise<AdminZone>;
  versions(zoneId: string): Promise<AdminZoneVersion[]>;
  /** Restoring writes a NEW version; the history stays append-only. */
  restore(zoneId: string, versionId: string): Promise<AdminZone>;
  /** The dry run: who is inside, what moves, what a reshape would cost. */
  preview(body: AdminZonePreviewRequest): Promise<AdminZonePreview>;
}

/** Mock edits apply, so drawing a box and saving it makes it appear in the list. */
let mockItems: AdminZone[] = adminZoneMocks;
let mockVersions: Record<string, AdminZoneVersion[]> = Object.fromEntries(
  adminZoneMocks.map((zone) => [zone.id, adminZoneVersionsMock(zone.id)]),
);

/** Deterministic ids, so a mock re-render never remounts the list. */
let mockSequence = 0;
const mockId = () => `00000000-0000-4000-8000-${String(++mockSequence).padStart(12, '0')}`;

function upsertMock(zone: AdminZone): AdminZone {
  mockItems = mockItems.some((item) => item.id === zone.id)
    ? mockItems.map((item) => (item.id === zone.id ? zone : item))
    : [...mockItems, zone];
  return zone;
}

/** The mock's version snapshot of whatever a write just produced. */
function snapshot(zone: AdminZone, reason: string | null): AdminZoneVersion {
  return {
    id: mockId(),
    version: zone.version,
    area: zone.area,
    surgeBand: zone.surgeBand,
    isHighway: zone.isHighway,
    isActive: zone.isActive,
    dispatchConfig: zone.dispatchConfig,
    changedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reason,
    createdAt: zone.updatedAt,
  };
}

/** Bounding boxes only — the mock says which zones a box would touch, not how much. */
function mockOverlaps(area: AdminZone['area'], excludeZoneId?: string): AdminZonePreview['overlaps'] {
  const ring = area.coordinates[0]!;
  const [minLng, minLat, maxLng, maxLat] = [
    Math.min(...ring.map(([lng]) => lng!)),
    Math.min(...ring.map(([, lat]) => lat!)),
    Math.max(...ring.map(([lng]) => lng!)),
    Math.max(...ring.map(([, lat]) => lat!)),
  ];

  return mockItems
    .filter((zone) => zone.id !== excludeZoneId)
    .filter((zone) => {
      const other = zone.area.coordinates[0]!;
      const otherLngs = other.map(([lng]) => lng!);
      const otherLats = other.map(([, lat]) => lat!);
      return (
        Math.min(...otherLngs) <= maxLng &&
        Math.max(...otherLngs) >= minLng &&
        Math.min(...otherLats) <= maxLat &&
        Math.max(...otherLats) >= minLat
      );
    })
    .map((zone) => ({ zoneId: zone.id, zoneName: zone.name, areaKm2: zone.areaKm2 }));
}

const mockSource: AdminZonesDataSource = {
  list: () =>
    resolveMock(env.mockAdminZonesState, { ...adminZonesMock, items: mockItems }, {
      ...adminZonesMock,
      items: [],
    }),

  create: async (body) => {
    await mockDelay();
    const now = new Date().toISOString();
    const zone: AdminZone = {
      id: mockId(),
      code: body.code,
      name: body.name,
      notes: body.notes ?? null,
      dispatchConfig: body.dispatchConfig ?? null,
      surgeBand: body.surgeBand,
      isHighway: body.isHighway,
      isActive: true,
      version: 1,
      area: body.area,
      areaKm2: approxAreaKm2(body.area),
      updatedAt: now,
      updatedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    mockVersions = { ...mockVersions, [zone.id]: [snapshot(zone, body.reason ?? null)] };
    return upsertMock(zone);
  },

  update: async (zoneId, body) => {
    await mockDelay();
    const before = mockItems.find((item) => item.id === zoneId);
    if (!before) throw new Error('Zone not found');

    const { reason, ...patch } = body;
    const zone: AdminZone = {
      ...before,
      ...patch,
      // A shape change is a new version, exactly like the service does it.
      version: patch.area ? before.version + 1 : before.version,
      areaKm2: patch.area ? approxAreaKm2(patch.area) : before.areaKm2,
      updatedAt: new Date().toISOString(),
      updatedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    if (patch.area) {
      mockVersions = {
        ...mockVersions,
        [zoneId]: [snapshot(zone, reason ?? null), ...(mockVersions[zoneId] ?? [])],
      };
    }
    return upsertMock(zone);
  },

  setActive: async (zoneId, active, reason) => {
    await mockDelay();
    const before = mockItems.find((item) => item.id === zoneId);
    if (!before) throw new Error('Zone not found');
    const zone: AdminZone = {
      ...before,
      isActive: active,
      version: before.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    mockVersions = {
      ...mockVersions,
      [zoneId]: [snapshot(zone, reason ?? (active ? 'Reopened' : 'Paused')), ...(mockVersions[zoneId] ?? [])],
    };
    return upsertMock(zone);
  },

  versions: async (zoneId) => {
    await mockDelay();
    if (env.mockAdminZonesState === 'error') throw new Error('Mock error state (forced via env)');
    return mockVersions[zoneId] ?? [];
  },

  restore: async (zoneId, versionId) => {
    await mockDelay();
    const before = mockItems.find((item) => item.id === zoneId);
    const target = (mockVersions[zoneId] ?? []).find((entry) => entry.id === versionId);
    if (!before || !target) throw new Error('Version not found');

    const zone: AdminZone = {
      ...before,
      area: target.area,
      areaKm2: approxAreaKm2(target.area),
      surgeBand: target.surgeBand,
      isHighway: target.isHighway,
      version: before.version + 1,
      updatedAt: new Date().toISOString(),
    };
    mockVersions = {
      ...mockVersions,
      [zoneId]: [snapshot(zone, `Restored version ${target.version}`), ...(mockVersions[zoneId] ?? [])],
    };
    return upsertMock(zone);
  },

  preview: async (body) => {
    await mockDelay();
    return {
      areaKm2: approxAreaKm2(body.area),
      // The mock cannot count presence or bookings — it says so in the panel
      // rather than inventing a number an operator might act on.
      onlineDriversInside: 0,
      driversToEvict: 0,
      liveBookingsInside: 0,
      overlaps: mockOverlaps(body.area, body.excludeZoneId),
    };
  },
};

const restSource: AdminZonesDataSource = {
  list: () => adminApiFetch<AdminZonesResponse>('zones'),
  create: (body) => adminApiFetch<AdminZone>('zones', { method: 'POST', body: JSON.stringify(body) }),
  update: (zoneId, body) =>
    adminApiFetch<AdminZone>(`zones/${zoneId}`, { method: 'PUT', body: JSON.stringify(body) }),
  setActive: (zoneId, active, reason) =>
    adminApiFetch<AdminZone>(`zones/${zoneId}/${active ? 'activate' : 'deactivate'}`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  versions: (zoneId) => adminApiFetch<AdminZoneVersion[]>(`zones/${zoneId}/versions`),
  restore: (zoneId, versionId) =>
    adminApiFetch<AdminZone>(`zones/${zoneId}/versions/${versionId}/restore`, { method: 'POST' }),
  preview: (body) =>
    adminApiFetch<AdminZonePreview>('zones/preview', { method: 'POST', body: JSON.stringify(body) }),
};

export const adminZonesDataSource: AdminZonesDataSource = env.useMocks ? mockSource : restSource;
