import type {
  AdminActivityItem,
  AdminDispatchInspectorListResponse,
  AdminDispatchInspectorResponse,
  AdminOpsBadges,
  AdminOpsKpis,
  AdminOpsLiveResponse,
} from '@towing/api-contracts';

/**
 * Mocks-on fixtures for the ops dashboard and map.
 *
 * Like every other admin feature, nothing here is a mutation: the console's
 * specs assert renders and client-side behaviour, and anything with a real
 * side effect is proven in `e2e-live` against the backend.
 *
 * The badge counts mirror what the SERVER can compute today — the four
 * features whose tables do not exist yet stay zero rather than inventing
 * numbers the real endpoint would never return.
 */

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

/** Driver pings are fresh on purpose: 15 s is the live→stale threshold. */
const secondsAgo = (seconds: number): string =>
  new Date(Date.now() - seconds * 1_000).toISOString();

export const adminOpsKpisMock: AdminOpsKpis = {
  activeRides: 3,
  searching: 2,
  onlineDrivers: 12,
  dispatchableNow: 11,
  todayGmvPaise: 845_000,
  todayCommissionPaise: 126_750,
  pendingKyc: 4,
  pendingPayouts: 2,
  fillRatePct: 92.5,
  cancelledToday: 3,
  completedUnpaid: 1,
  timeToMatchP50Seconds: 42,
  timeToMatchP90Seconds: 128,
};

export const adminOpsBadgesMock: AdminOpsBadges = {
  pendingKyc: 4,
  pendingPayouts: 2,
  openSos: 0,
  openDisputes: 0,
  openTickets: 0,
  suspensionRequests: 0,
  deletionRequests: 1,
};

export const adminOpsActivityMock: AdminActivityItem[] = [
  {
    id: 'booking_created:00000000-0000-4000-8000-0000000000a1',
    kind: 'booking_created',
    at: minutesAgo(2),
    bookingId: '00000000-0000-4000-8000-0000000000a1',
    zoneId: '00000000-0000-4000-8000-0000000000e1',
    status: 'searching',
    scheduledAt: null,
    action: null,
    subjectType: null,
    subjectId: null,
    adminId: null,
  },
  {
    id: 'booking_status:00000000-0000-4000-8000-0000000000a2',
    kind: 'booking_status',
    at: minutesAgo(7),
    bookingId: '00000000-0000-4000-8000-0000000000a2',
    zoneId: '00000000-0000-4000-8000-0000000000e1',
    status: 'assigned',
    scheduledAt: null,
    action: null,
    subjectType: null,
    subjectId: null,
    adminId: null,
  },
  {
    id: 'admin_action:00000000-0000-4000-8000-0000000000a3',
    kind: 'admin_action',
    at: minutesAgo(14),
    bookingId: null,
    zoneId: null,
    status: null,
    scheduledAt: null,
    action: 'driver.kyc.approve',
    subjectType: 'driver',
    subjectId: '00000000-0000-4000-8000-0000000000d1',
    adminId: '00000000-0000-4000-8000-000000000001',
  },
];

export const adminOpsLiveMock: AdminOpsLiveResponse = {
  drivers: [
    {
      driverId: '00000000-0000-4000-8000-0000000000d2',
      name: 'Ravi Kumar',
      zoneId: '00000000-0000-4000-8000-0000000000e1',
      lat: 12.9716,
      lng: 77.5946,
      headingDeg: 92,
      speedKph: 31,
      at: secondsAgo(8),
      fromFallback: false,
      dispatchable: true,
    },
    {
      driverId: '00000000-0000-4000-8000-0000000000d3',
      name: 'Imran Sheikh',
      zoneId: '00000000-0000-4000-8000-0000000000e1',
      lat: 12.9569,
      lng: 77.6412,
      headingDeg: 210,
      speedKph: 24,
      at: secondsAgo(12),
      fromFallback: false,
      // W6: a suspended-fleet driver — drawn, but no offer would reach them.
      dispatchable: false,
    },
    {
      driverId: '00000000-0000-4000-8000-0000000000d4',
      name: 'Deepa Nair',
      zoneId: null,
      lat: null,
      lng: null,
      headingDeg: null,
      speedKph: null,
      at: null,
      fromFallback: true,
      dispatchable: true,
    },
  ],
  bookings: [
    {
      bookingId: '00000000-0000-4000-8000-0000000000a2',
      status: 'en_route',
      serviceType: 'tow',
      zoneId: '00000000-0000-4000-8000-0000000000e1',
      driverId: '00000000-0000-4000-8000-0000000000d2',
      pickup: { lat: 12.965, lng: 77.6 },
      drop: { lat: 12.956, lng: 77.7 },
      createdAt: minutesAgo(9),
    },
    {
      bookingId: '00000000-0000-4000-8000-0000000000a4',
      status: 'in_progress',
      serviceType: 'flatbed',
      zoneId: '00000000-0000-4000-8000-0000000000e1',
      driverId: '00000000-0000-4000-8000-0000000000d3',
      pickup: { lat: 12.94, lng: 77.62 },
      drop: null,
      createdAt: minutesAgo(21),
    },
  ],
  zones: [
    {
      id: '00000000-0000-4000-8000-0000000000e1',
      name: 'Bengaluru Central',
      geometry: {
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
      },
    },
  ],
  at: new Date().toISOString(),
  degraded: false,
};

// ---------------------------------------------------------------------------
// W5 — dispatch inspector
// ---------------------------------------------------------------------------

const DISPATCH_BOOKING_ID = '00000000-0000-4000-8000-0000000000a5';
const DISPATCH_DEADLINE = new Date(Date.now() + 90_000).toISOString();

/** The §6.2 weights in force in every fixture wave — the code defaults. */
const dispatchWeights = { proximity: 60, rating: 15, acceptance: 15, completion: 10 };

/** Resolved defaults (`resolveDispatchConfig(null)`), verbatim. */
const dispatchConfigView = {
  radiusLadderKm: [2, 4, 7, 10, 15],
  bandCRadiusLadderKm: [10, 25, 50],
  offerTimeoutSeconds: 20,
  offersPerWave: 3,
  maxSearchSeconds: 180,
};

/** Two live searches: one two waves in, one created a minute ago. */
export const adminDispatchSearchesMock: AdminDispatchInspectorListResponse = {
  items: [
    {
      bookingId: DISPATCH_BOOKING_ID,
      zoneId: '00000000-0000-4000-8000-0000000000e1',
      serviceType: 'tow',
      vehicleClass: 'flatbed',
      wave: 2,
      radiusKm: 4,
      contacted: 4,
      longDistance: false,
      deadlineAt: DISPATCH_DEADLINE,
      createdAt: minutesAgo(4),
    },
    {
      bookingId: '00000000-0000-4000-8000-0000000000a6',
      zoneId: null,
      serviceType: 'flatbed',
      vehicleClass: 'wheel_lift',
      wave: null,
      radiusKm: null,
      contacted: 0,
      longDistance: false,
      deadlineAt: null,
      createdAt: minutesAgo(1),
    },
  ],
  at: new Date().toISOString(),
};

/**
 * Two waves whose per-term values RECOMPUTE to the stored score — the spec in
 * `e2e/admin-dispatch-inspector.spec.ts` renders these bars, and the backend
 * e2e asserts the same identity against the real engine. Each `score` below is
 * exactly `Σ term × weight`.
 */
export const adminDispatchInspectorMock: AdminDispatchInspectorResponse = {
  booking: {
    bookingId: DISPATCH_BOOKING_ID,
    status: 'searching',
    serviceType: 'tow',
    vehicleClass: 'flatbed',
    zoneId: '00000000-0000-4000-8000-0000000000e1',
    userId: '00000000-0000-4000-8000-0000000000c1',
    customerName: 'Meera Iyer',
    customerMobile: '+91 98450 00042',
    pickup: { lat: 12.9716, lng: 77.5946 },
    pickupAddress: 'MG Road, Bengaluru',
    drop: { lat: 12.9345, lng: 77.6266 },
    longDistance: false,
    searchWave: 2,
    deadlineAt: DISPATCH_DEADLINE,
    scheduledAt: null,
    createdAt: minutesAgo(4),
  },
  waves: [
    {
      id: '00000000-0000-4000-8000-0000000000f1',
      wave: 1,
      radiusKm: 2,
      considered: 4,
      eligible: 3,
      offered: 3,
      degraded: false,
      weights: dispatchWeights,
      config: dispatchConfigView,
      excluded: {
        offline: { count: 1, driverIds: ['00000000-0000-4000-8000-0000000000d7'] },
      },
      candidates: [
        {
          driverId: '00000000-0000-4000-8000-0000000000d2',
          distanceM: 620,
          proximity: 0.95,
          rating: 0.9,
          acceptance: 0.4,
          completion: 1,
          score: 86.5,
          offered: true,
        },
        {
          driverId: '00000000-0000-4000-8000-0000000000d3',
          distanceM: 1400,
          proximity: 0.8,
          rating: 0.8,
          acceptance: 0.6,
          completion: 0.9,
          score: 78,
          offered: true,
        },
        {
          driverId: '00000000-0000-4000-8000-0000000000d4',
          distanceM: 1850,
          proximity: 0.5,
          rating: 0.7,
          acceptance: 0.5,
          completion: 0.8,
          score: 56,
          offered: true,
        },
      ],
      ranAt: minutesAgo(3),
      durationMs: 148,
    },
    {
      id: '00000000-0000-4000-8000-0000000000f2',
      wave: 2,
      radiusKm: 4,
      considered: 6,
      eligible: 4,
      offered: 2,
      degraded: false,
      weights: dispatchWeights,
      config: dispatchConfigView,
      excluded: {
        already_offered: {
          count: 2,
          driverIds: [
            '00000000-0000-4000-8000-0000000000d2',
            '00000000-0000-4000-8000-0000000000d3',
          ],
        },
        offline: { count: 1, driverIds: ['00000000-0000-4000-8000-0000000000d7'] },
      },
      candidates: [
        {
          driverId: '00000000-0000-4000-8000-0000000000d5',
          distanceM: 2600,
          proximity: 0.97,
          rating: 0.9,
          acceptance: 0.8,
          completion: 1,
          score: 93.7,
          offered: true,
        },
        {
          driverId: '00000000-0000-4000-8000-0000000000d6',
          distanceM: 3100,
          proximity: 0.9,
          rating: 0.8,
          acceptance: 0.75,
          completion: 0.9,
          score: 86.25,
          offered: true,
        },
        {
          driverId: '00000000-0000-4000-8000-0000000000d8',
          distanceM: 3600,
          proximity: 0.75,
          rating: 0.75,
          acceptance: 0.5,
          completion: 0.9,
          score: 72.75,
          offered: false,
        },
      ],
      ranAt: minutesAgo(1),
      durationMs: 132,
    },
  ],
  attempts: [
    {
      driverId: '00000000-0000-4000-8000-0000000000d2',
      driverName: 'Ravi Kumar',
      driverMobile: '+91 98450 00002',
      wave: 1,
      radiusKm: 2,
      outcome: 'offered',
      offeredAt: minutesAgo(3),
      respondedAt: null,
    },
    {
      driverId: '00000000-0000-4000-8000-0000000000d3',
      driverName: 'Imran Sheikh',
      driverMobile: '+91 98450 00003',
      wave: 1,
      radiusKm: 2,
      outcome: 'expired',
      offeredAt: minutesAgo(3),
      respondedAt: minutesAgo(3),
    },
    {
      driverId: '00000000-0000-4000-8000-0000000000d4',
      driverName: 'Deepa Nair',
      driverMobile: '+91 98450 00004',
      wave: 1,
      radiusKm: 2,
      outcome: 'rejected',
      offeredAt: minutesAgo(3),
      respondedAt: minutesAgo(3),
    },
    {
      driverId: '00000000-0000-4000-8000-0000000000d5',
      driverName: 'Suresh Babu',
      driverMobile: '+91 98450 00005',
      wave: 2,
      radiusKm: 4,
      outcome: 'offered',
      offeredAt: minutesAgo(1),
      respondedAt: null,
    },
  ],
  config: dispatchConfigView,
  weights: dispatchWeights,
  liveWave: 2,
  deadlineAt: DISPATCH_DEADLINE,
};
