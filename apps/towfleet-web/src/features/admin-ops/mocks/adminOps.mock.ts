import type {
  AdminActivityItem,
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
      at: minutesAgo(1),
      fromFallback: false,
    },
    {
      driverId: '00000000-0000-4000-8000-0000000000d3',
      name: 'Imran Sheikh',
      zoneId: '00000000-0000-4000-8000-0000000000e1',
      lat: 12.9569,
      lng: 77.6412,
      headingDeg: 210,
      speedKph: 24,
      at: minutesAgo(2),
      fromFallback: false,
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
