import type {
  AdminBookingDetail,
  AdminBookingInvoice,
  AdminBookingSummary,
  JobStatus,
} from '@towing/api-contracts';

const HOUR = 60 * 60 * 1000;

/**
 * W8's bookings fixture — nine rows spanning every state the console's
 * filters and exits are about:
 *
 *  - both LIVE PROBLEMS (`searching`, `no_drivers_found`) so the list's
 *    "live problems" chip has something to narrow to;
 *  - the §14.2 case the whole unpaid-intervention pair (recheck + remind)
 *    exists for: COMPLETED with a failed booking payment (b3);
 *  - a disputed row (b5) whose open dispute the detail banner and the
 *    disputes queue both point at;
 *  - a cancelled row (b9) with the fee and driver compensation already
 *    recorded, because those two numbers are the ones an operator second-
 *    guesses.
 *
 * Ids are fixed UUIDs: the dispute fixture names them, and the mocks-on specs
 * navigate straight to `/admin/bookings/b3`.
 */

/** The §14.2 unpaid intervention: completed, booking payment failed. */
export const MOCK_BOOKING_UNPAID = '33333333-3333-4333-8333-333333333333';
/** Paid, with an open dispute (d1) hanging off it. */
export const MOCK_BOOKING_PAID = '44444444-4444-4444-8444-444444444444';
/** Disputed — the open dispute d4 IS the booking's status. */
export const MOCK_BOOKING_DISPUTED = '55555555-5555-4555-8555-555555555555';
/** Paid after a resolved partial-refund dispute (d3) — refunds render here. */
export const MOCK_BOOKING_REFUNDED = '77777777-7777-4777-8777-777777777777';

const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * HOUR).toISOString();

const FLEET_ID = 'f0000000-0000-4000-8000-000000000001';
const DRIVER_ANIL = 'd0000000-0000-4000-8000-000000000001';
const DRIVER_SURESH = 'd0000000-0000-4000-8000-000000000002';
const ZONE_KORAMANGALA = 'z0000000-0000-4000-8000-000000000001';
const ZONE_WHITEFIELD = 'z0000000-0000-4000-8000-000000000002';

const base = {
  serviceType: 'tow' as const,
  commissionBand: 'A' as const,
  commissionPct: 10,
  driverPayoutPaise: 0, // overwritten per row
};

export const adminBookingsMock: AdminBookingSummary[] = [
  {
    ...base,
    id: '11111111-1111-4111-8111-111111111111',
    code: 'TW-1A2B3C4D',
    status: 'assigned',
    vehicleClass: 'wheel_lift',
    userId: 'aa000000-0000-4000-8000-000000000001',
    userName: 'Ramesh Kumar',
    userMobile: '+919845000101',
    driverId: DRIVER_ANIL,
    driverName: 'Anil Prasad',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_KORAMANGALA,
    zoneName: 'Koramangala',
    pickupAddress: '12th Main, Indiranagar',
    dropAddress: 'MG Road Metro',
    distanceKm: 6.4,
    totalPaise: 25_000,
    commissionPaise: 2_500,
    driverPayoutPaise: 22_500,
    scheduledAt: null,
    createdAt: iso(2),
    updatedAt: iso(1),
  },
  {
    ...base,
    id: '22222222-2222-4222-8222-222222222222',
    code: 'TW-2B3C4D5E',
    status: 'in_progress',
    vehicleClass: 'flatbed',
    userId: 'aa000000-0000-4000-8000-000000000002',
    userName: 'Meera Iyer',
    userMobile: '+919845000102',
    driverId: DRIVER_SURESH,
    driverName: 'Suresh Nair',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_WHITEFIELD,
    zoneName: 'Whitefield',
    pickupAddress: 'ITPL Main Road',
    dropAddress: 'Brookefield',
    distanceKm: 11.2,
    totalPaise: 68_000,
    commissionPaise: 6_800,
    driverPayoutPaise: 61_200,
    scheduledAt: null,
    createdAt: iso(4),
    updatedAt: iso(1),
  },
  {
    ...base,
    id: MOCK_BOOKING_UNPAID,
    code: 'TW-3C4D5E6F',
    status: 'completed',
    vehicleClass: 'wheel_lift',
    userId: 'aa000000-0000-4000-8000-000000000003',
    userName: 'Vikram Rao',
    userMobile: '+919845000103',
    driverId: DRIVER_ANIL,
    driverName: 'Anil Prasad',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_KORAMANGALA,
    zoneName: 'Koramangala',
    pickupAddress: 'Forum Mall Gate 2',
    dropAddress: 'Jayanagar 4th Block',
    distanceKm: 9.8,
    totalPaise: 96_000,
    commissionPaise: 9_600,
    driverPayoutPaise: 86_400,
    scheduledAt: null,
    createdAt: iso(26),
    updatedAt: iso(22),
  },
  {
    ...base,
    id: MOCK_BOOKING_PAID,
    code: 'TW-4D5E6F70',
    status: 'paid',
    vehicleClass: 'flatbed',
    userId: 'aa000000-0000-4000-8000-000000000004',
    userName: 'Lakshmi Devi',
    userMobile: '+919845000104',
    driverId: DRIVER_SURESH,
    driverName: 'Suresh Nair',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_WHITEFIELD,
    zoneName: 'Whitefield',
    pickupAddress: 'Hosur Road, Silk Board',
    dropAddress: 'Electronic City Phase 2',
    distanceKm: 34.1,
    totalPaise: 240_000,
    commissionBand: 'B',
    commissionPct: 8,
    commissionPaise: 19_200,
    driverPayoutPaise: 220_800,
    scheduledAt: null,
    createdAt: iso(50),
    updatedAt: iso(44),
  },
  {
    ...base,
    id: MOCK_BOOKING_DISPUTED,
    code: 'TW-5E6F7081',
    status: 'disputed',
    vehicleClass: 'wheel_lift',
    userId: 'aa000000-0000-4000-8000-000000000005',
    userName: 'Farhan Ali',
    userMobile: '+919845000105',
    driverId: DRIVER_SURESH,
    driverName: 'Suresh Nair',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_WHITEFIELD,
    zoneName: 'Whitefield',
    pickupAddress: 'Marathahalli Bridge',
    dropAddress: 'CV Raman Nagar',
    distanceKm: 7.7,
    totalPaise: 45_000,
    commissionPaise: 4_500,
    driverPayoutPaise: 40_500,
    scheduledAt: null,
    createdAt: iso(8),
    updatedAt: iso(3),
  },
  {
    ...base,
    id: '66666666-6666-4666-8666-666666666666',
    code: 'TW-6F708192',
    status: 'searching',
    vehicleClass: 'wheel_lift',
    userId: 'aa000000-0000-4000-8000-000000000006',
    userName: 'Neha Gupta',
    userMobile: '+919845000106',
    driverId: null,
    driverName: null,
    fleetId: null,
    fleetName: null,
    zoneId: ZONE_KORAMANGALA,
    zoneName: 'Koramangala',
    pickupAddress: 'Sony World Junction',
    dropAddress: null,
    distanceKm: null,
    totalPaise: 18_000,
    commissionPaise: 1_800,
    driverPayoutPaise: 16_200,
    scheduledAt: null,
    createdAt: iso(0.2),
    updatedAt: iso(0.2),
  },
  {
    ...base,
    id: '77777777-7777-4777-8777-777777777777',
    code: 'TW-708192A3',
    status: 'paid',
    vehicleClass: 'wheel_lift',
    userId: 'aa000000-0000-4000-8000-000000000007',
    userName: 'Arun Kumar',
    userMobile: '+919845000107',
    driverId: DRIVER_ANIL,
    driverName: 'Anil Prasad',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_KORAMANGALA,
    zoneName: 'Koramangala',
    pickupAddress: 'Brigade Road',
    dropAddress: 'Richmond Circle',
    distanceKm: 4.2,
    totalPaise: 150_000,
    commissionPaise: 15_000,
    driverPayoutPaise: 135_000,
    scheduledAt: null,
    createdAt: iso(98),
    updatedAt: iso(90),
  },
  {
    ...base,
    id: '88888888-8888-4888-8888-888888888888',
    code: 'TW-8192A3B4',
    status: 'completed',
    vehicleClass: 'flatbed',
    userId: 'aa000000-0000-4000-8000-000000000008',
    userName: 'Divya Menon',
    userMobile: '+919845000108',
    driverId: DRIVER_ANIL,
    driverName: 'Anil Prasad',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_KORAMANGALA,
    zoneName: 'Koramangala',
    pickupAddress: 'Lalbagh West Gate',
    dropAddress: 'Kanakapura Road',
    distanceKm: 15.3,
    totalPaise: 88_000,
    commissionPaise: 8_800,
    driverPayoutPaise: 79_200,
    scheduledAt: null,
    createdAt: iso(30),
    updatedAt: iso(25),
  },
  {
    ...base,
    id: '99999999-9999-4999-8999-999999999999',
    code: 'TW-92A3B4C5',
    status: 'cancelled',
    vehicleClass: 'wheel_lift',
    userId: 'aa000000-0000-4000-8000-000000000009',
    userName: 'Priya Sharma',
    userMobile: '+919845000109',
    driverId: DRIVER_ANIL,
    driverName: 'Anil Prasad',
    fleetId: FLEET_ID,
    fleetName: 'Bengaluru Towing Co.',
    zoneId: ZONE_KORAMANGALA,
    zoneName: 'Koramangala',
    pickupAddress: 'Hebbal Flyover',
    dropAddress: null,
    distanceKm: null,
    totalPaise: 30_000,
    commissionPaise: 3_000,
    driverPayoutPaise: 27_000,
    scheduledAt: null,
    createdAt: iso(72),
    updatedAt: iso(71),
  },
];

/**
 * Per-booking detail patches. Anything not named here is SYNTHESISED from the
 * summary row — one fixture table, no second copy of nine bookings.
 */
const DETAIL_OVERRIDES: Record<string, Partial<AdminBookingDetail>> = {
  [MOCK_BOOKING_UNPAID]: {
    waitingFreeMinutes: 10,
    waitingPerMinutePaise: 500,
    completedAt: iso(22),
    payments: [
      {
        id: 'c0000000-0000-4000-8000-000000000001',
        purpose: 'booking',
        status: 'failed',
        method: 'upi',
        amountPaise: 96_000,
        refundedAmountPaise: 0,
        capturedAt: null,
        failureReason: 'Customer abandoned the payment sheet',
        createdAt: iso(22),
      },
    ],
  },
  [MOCK_BOOKING_PAID]: {
    completedAt: iso(44),
    paidAt: iso(44),
    payments: [
      {
        id: 'c0000000-0000-4000-8000-000000000002',
        purpose: 'booking',
        status: 'captured',
        method: 'upi',
        amountPaise: 240_000,
        refundedAmountPaise: 0,
        capturedAt: iso(44),
        failureReason: null,
        createdAt: iso(44),
      },
    ],
  },
  [MOCK_BOOKING_REFUNDED]: {
    completedAt: iso(90),
    paidAt: iso(90),
    payments: [
      {
        id: 'c0000000-0000-4000-8000-000000000003',
        purpose: 'booking',
        status: 'refunded',
        method: 'card',
        amountPaise: 150_000,
        refundedAmountPaise: 50_000,
        capturedAt: iso(90),
        failureReason: null,
        createdAt: iso(90),
      },
    ],
    refunds: [
      {
        id: 'e0000000-0000-4000-8000-000000000001',
        kind: 'partial',
        amountPaise: 50_000,
        reason: 'Overcharged on waiting time — partial refund agreed',
        status: 'processed',
        disputeId: 'a1a1a1a1-1111-4111-8111-111111111111',
        processedAt: iso(80),
        createdAt: iso(80),
      },
    ],
  },
  '99999999-9999-4999-8999-999999999999': {
    cancelledBy: 'customer',
    cancellationReason: 'Customer found another truck',
    cancellationFeePaise: 15_000,
    driverCompensationPaise: 7_500,
  },
};

/** The status ladder a healthy booking walks, plus the two terminal branches. */
function timelineFor(summary: AdminBookingSummary): AdminBookingDetail['timeline'] {
  const order: JobStatus[] = [
    'searching',
    'assigned',
    'en_route',
    'arrived',
    'in_progress',
    'completed',
    'paid',
  ];
  const end = order.indexOf(summary.status);
  const chain: JobStatus[] =
    end >= 0
      ? order.slice(0, end + 1)
      : summary.status === 'disputed'
        ? ['searching', 'assigned', 'en_route', 'arrived', 'in_progress', 'disputed']
        : summary.status === 'no_drivers_found'
          ? ['searching', 'no_drivers_found']
          : ['searching', 'cancelled'];

  return chain.map((status, index) => ({
    status,
    actor: status === 'cancelled' ? 'customer' : index === chain.length - 1 ? 'system' : 'driver',
    actorId: null,
    note: null,
    at: new Date(Date.now() - (chain.length - index) * HOUR).toISOString(),
  }));
}

export function adminBookingDetailMock(bookingId: string): AdminBookingDetail {
  const summary = adminBookingsMock.find((row) => row.id === bookingId);
  if (!summary) {
    throw new Error(`Mock booking ${bookingId} does not exist`);
  }
  const overrides = DETAIL_OVERRIDES[bookingId] ?? {};
  const commissionPaise = summary.commissionPaise;

  return {
    ...summary,
    pickupLat: 12.9716,
    pickupLng: 77.6412,
    dropLat: 12.9352,
    dropLng: 77.6245,
    note: null,
    contactName: null,
    contactMobile: null,
    waitingFreeMinutes: null,
    waitingPerMinutePaise: null,
    completedAt: null,
    paidAt: null,
    cancelledBy: null,
    cancellationReason: null,
    cancellationFeePaise: 0,
    driverCompensationPaise: 0,
    unableReason: null,
    searchWave: summary.driverId ? 1 : 2,
    dispatchDeadlineAt: null,
    breakdown: {
      baseFarePaise: 15_000,
      distanceChargePaise: summary.totalPaise - 17_500,
      nightChargePaise: 0,
      highwayChargePaise: 0,
      accidentChargePaise: 0,
      waitingChargePaise: 2_500,
      surgePaise: 0,
      discountPaise: 0,
      taxPct: 0,
      taxAmountPaise: 0,
      totalPaise: summary.totalPaise,
      commissionBand: summary.commissionBand,
      commissionPct: summary.commissionPct,
      commissionPaise,
      driverPayoutPaise: summary.driverPayoutPaise,
    },
    timeline: timelineFor(summary),
    payments: [],
    refunds: [],
    openDisputeId: summary.status === 'disputed' ? 'a4a4a4a4-4444-4444-8444-444444444444' : null,
    ...overrides,
  };
}

/** `GET /:id/invoice` — a URL like the real signed one; short-lived by shape. */
export const adminBookingInvoiceMock: AdminBookingInvoice = {
  url: 'https://mock.towing.local/invoices/TW-fixture.pdf',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
};

/** §6.5's reassign offers a driver — the fixture list the dialog picks from. */
export const adminBookingDriverChoicesMock = [
  { id: DRIVER_ANIL, name: 'Anil Prasad' },
  { id: DRIVER_SURESH, name: 'Suresh Nair' },
  { id: 'd0000000-0000-4000-8000-000000000003', name: 'Imran Khan' },
];
