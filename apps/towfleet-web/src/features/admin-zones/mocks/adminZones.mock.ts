import type {
  AdminZone,
  AdminZoneVersion,
  AdminZonesResponse,
  GeoJsonPolygon,
} from '@towing/api-contracts';

/**
 * W13's zone editor against the seeded marketplace: the Bengaluru Metro box the
 * seed draws, the Chennai box, and the NH-44 corridor — which CROSSES the
 * Bengaluru one on purpose, because "zones may overlap and the resolver picks
 * by highway-then-area" is the thing an operator has to be able to see.
 */

const BENGALURU: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [77.45, 12.8],
      [77.8, 12.8],
      [77.8, 13.15],
      [77.45, 13.15],
      [77.45, 12.8],
    ],
  ],
};

const CHENNAI: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [80.05, 12.85],
      [80.32, 12.85],
      [80.32, 13.15],
      [80.05, 13.15],
      [80.05, 12.85],
    ],
  ],
};

const NH44: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [77.62, 12.7],
      [77.72, 12.7],
      [77.72, 12.95],
      [77.62, 12.95],
      [77.62, 12.7],
    ],
  ],
};

/** Roughly the degrees→km box area, so the number is at least the right order. */
function approxAreaKm2(area: GeoJsonPolygon): number {
  const ring = area.coordinates[0]!;
  const lngs = ring.map(([lng]) => lng!);
  const lats = ring.map(([, lat]) => lat!);
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((midLat * Math.PI) / 180);
  return (
    Math.round(
      (Math.max(...lngs) - Math.min(...lngs)) * kmPerDegLng *
        ((Math.max(...lats) - Math.min(...lats)) * kmPerDegLat) *
        10,
    ) / 10
  );
}

export const adminZoneMocks: AdminZone[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'bengaluru-metro',
    name: 'Bengaluru Metro',
    notes: 'The launch city. Closest to the seed data.',
    dispatchConfig: { radiusLadderKm: [2, 4, 7, 10, 15], offersPerWave: 3 },
    surgeBand: 'standard',
    isHighway: false,
    isActive: true,
    version: 3,
    area: BENGALURU,
    areaKm2: approxAreaKm2(BENGALURU),
    updatedAt: '2026-02-14T09:30:00.000Z',
    updatedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'chennai-metro',
    name: 'Chennai Metro',
    notes: null,
    dispatchConfig: null,
    surgeBand: 'high',
    isHighway: false,
    isActive: true,
    version: 1,
    area: CHENNAI,
    areaKm2: approxAreaKm2(CHENNAI),
    updatedAt: '2026-01-05T06:00:00.000Z',
    updatedBy: null,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    code: 'nh-44-bengaluru-hosur',
    name: 'NH-44 Bengaluru–Hosur Corridor',
    notes: 'Crosses Bengaluru Metro on purpose — the highway wins the overlap.',
    dispatchConfig: { offersPerWave: 5 },
    surgeBand: 'standard',
    isHighway: true,
    // The one dark zone: deactivated, so the list shows both states and the
    // resolver's "are we live here" answer has a negative case.
    isActive: false,
    version: 2,
    area: NH44,
    areaKm2: approxAreaKm2(NH44),
    updatedAt: '2026-02-20T11:15:00.000Z',
    updatedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
];

export const adminZonesMock: AdminZonesResponse = {
  items: adminZoneMocks,
  resolution: [
    '1. Highway zones win an overlap.',
    '2. Between zones of the same class, the smaller area wins.',
    '3. Inactive zones are skipped entirely.',
  ],
};

/** Newest first, like `GET /:id/versions`. */
export function adminZoneVersionsMock(zoneId: string): AdminZoneVersion[] {
  const zone = adminZoneMocks.find((item) => item.id === zoneId);
  if (!zone) return [];

  // Version 1 is always the seed's shape — the migrated row whose `changedBy`
  // is NULL. Zones on version 2+ additionally carry the reshape that got them
  // there, so the drawer has something to restore TO.
  const seeded: AdminZoneVersion = {
    id: '88888888-8888-4888-8888-888888888888',
    version: 1,
    area: zone.area,
    surgeBand: 'standard',
    isHighway: zone.isHighway,
    isActive: true,
    dispatchConfig: null,
    changedBy: null,
    reason: 'Seeded before the zone editor (W13)',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  if (zone.version === 1) return [seeded];

  return [
    {
      id: '99999999-9999-4999-8999-999999999999',
      version: zone.version,
      area: zone.area,
      surgeBand: zone.surgeBand,
      isHighway: zone.isHighway,
      isActive: zone.isActive,
      dispatchConfig: zone.dispatchConfig,
      changedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reason:
        zone.isActive === false
          ? 'Closed for a corridor resurvey'
          : 'Split the southern edge off the city box',
      createdAt: zone.updatedAt,
    },
    seeded,
  ];
}

export { approxAreaKm2 };
