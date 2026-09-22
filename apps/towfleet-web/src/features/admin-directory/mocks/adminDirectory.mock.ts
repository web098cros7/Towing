import type {
  AdminAppViewTripsResponse,
  AdminAppViewWalletResponse,
  AdminDirectoryUser,
  AdminDirectoryUserDetail,
  AdminDirectoryUserBookingsResponse,
  AdminDirectoryZone,
  AdminDriverDirectoryDetail,
  AdminDriverDirectoryItem,
  AdminDriverDecisionResponse,
  AdminDriverZonesResponse,
  AdminDriversDirectoryResponse,
  AdminFleetDetail,
  AdminFleetSuspensionResponse,
  AdminFleetsResponse,
  AdminImpersonationResponse,
  AdminSuspensionRequest,
  AdminSuspensionRequestsResponse,
} from '@towing/api-contracts';

/**
 * W6's directory fixtures. Ids are REAL v4 shapes with an easy-to-spot middle
 * (`...-a0000-...`), because e2e specs click through on text and an obviously
 * fake id in a URL is one less thing to misread during a failure.
 */

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

export const MOCK_USER_ACTIVE = id('1');
export const MOCK_USER_SUSPENDED = id('2');
export const MOCK_USER_QUIET = id('3');

export const MOCK_DRIVER_ONLINE = id('11');
export const MOCK_DRIVER_RESTRICTED = id('12');
export const MOCK_DRIVER_SUSPENDED = id('13');

export const MOCK_FLEET_BIG = id('21');
export const MOCK_FLEET_SUSPENDED = id('22');

export const MOCK_REQUEST_OPEN = id('31');
export const MOCK_REQUEST_DRIVER = id('32');

export const MOCK_ZONE_SOUTH = id('41');
export const MOCK_ZONE_NORTH = id('42');
export const MOCK_ZONE_AIRPORT = id('43');

export const MOCK_IMPERSONATION_SESSION = id('51');

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

export const adminDirectoryUsersMock: AdminDirectoryUser[] = [
  {
    id: MOCK_USER_ACTIVE,
    name: 'Meera Iyer',
    mobile: '+919845000001',
    email: 'meera@example.com',
    status: 'active',
    suspendedAt: null,
    suspensionReason: null,
    createdAt: at(120),
  },
  {
    id: MOCK_USER_SUSPENDED,
    name: 'Ravi Kumar',
    mobile: '+919845000002',
    email: null,
    status: 'suspended',
    suspendedAt: at(3),
    suspensionReason: 'Chargeback abuse',
    createdAt: at(90),
  },
  {
    id: MOCK_USER_QUIET,
    name: 'Asha Rao',
    mobile: '+919845000003',
    email: null,
    status: 'active',
    suspendedAt: null,
    suspensionReason: null,
    createdAt: at(14),
  },
];

export const adminDirectoryUserDetailMock: Record<string, AdminDirectoryUserDetail> = {
  [MOCK_USER_ACTIVE]: { ...adminDirectoryUsersMock[0]!, bookingsCount: 12 },
  [MOCK_USER_SUSPENDED]: { ...adminDirectoryUsersMock[1]!, bookingsCount: 3 },
  [MOCK_USER_QUIET]: { ...adminDirectoryUsersMock[2]!, bookingsCount: 0 },
};

export const adminDirectoryUserBookingsMock: AdminDirectoryUserBookingsResponse = {
  items: [
    {
      id: id('101'),
      status: 'paid',
      serviceType: 'tow',
      zoneId: MOCK_ZONE_SOUTH,
      driverId: MOCK_DRIVER_ONLINE,
      totalPaise: 145_000,
      createdAt: at(2),
      updatedAt: at(2),
    },
    {
      id: id('102'),
      status: 'cancelled',
      serviceType: 'battery',
      zoneId: MOCK_ZONE_SOUTH,
      driverId: null,
      totalPaise: 0,
      createdAt: at(9),
      updatedAt: at(9),
    },
  ],
  page: 1,
  limit: 25,
  total: 2,
};

export const adminSuspensionRequestsMock: AdminSuspensionRequest[] = [
  {
    id: MOCK_REQUEST_OPEN,
    subjectType: 'user',
    subjectId: MOCK_USER_SUSPENDED,
    reason: 'Three chargebacks this month',
    status: 'open',
    requestedBy: id('61'),
    createdAt: at(1),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  },
  {
    id: MOCK_REQUEST_DRIVER,
    subjectType: 'driver',
    subjectId: MOCK_DRIVER_SUSPENDED,
    reason: 'Repeated no-shows after accepting',
    status: 'open',
    requestedBy: id('61'),
    createdAt: at(2),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  },
];

export const adminDirectoryDriversMock: AdminDriverDirectoryItem[] = [
  {
    id: MOCK_DRIVER_ONLINE,
    name: 'Kiran Shetty',
    mobile: '+919845000011',
    kycStatus: 'approved',
    isOnline: true,
    lastPingAt: new Date(Date.now() - 12_000).toISOString(),
    zoneId: MOCK_ZONE_SOUTH,
    zoneName: 'South Zone',
    fleetId: MOCK_FLEET_BIG,
    fleetName: 'Bengaluru Heavy Towing',
    vehicleClass: 'flatbed',
    longDistanceEnabled: true,
    rating: 4.6,
    suspensionPending: false,
    suspendedAt: null,
    suspensionReason: null,
    createdAt: at(200),
  },
  {
    id: MOCK_DRIVER_RESTRICTED,
    name: 'Suresh Nair',
    mobile: '+919845000012',
    kycStatus: 'approved',
    isOnline: true,
    lastPingAt: new Date(Date.now() - 40_000).toISOString(),
    zoneId: MOCK_ZONE_NORTH,
    zoneName: 'North Zone',
    fleetId: null,
    fleetName: null,
    vehicleClass: 'wheel_lift',
    longDistanceEnabled: false,
    rating: 4.1,
    suspensionPending: false,
    suspendedAt: null,
    suspensionReason: null,
    createdAt: at(80),
  },
  {
    id: MOCK_DRIVER_SUSPENDED,
    name: 'Deepak Verma',
    mobile: '+919845000013',
    kycStatus: 'suspended',
    isOnline: false,
    lastPingAt: null,
    zoneId: null,
    zoneName: null,
    fleetId: MOCK_FLEET_SUSPENDED,
    fleetName: 'Mysuru Quick Tow',
    vehicleClass: 'flatbed',
    longDistanceEnabled: false,
    rating: 3.2,
    suspensionPending: false,
    suspendedAt: at(6),
    suspensionReason: 'Repeated no-shows after accepting',
    createdAt: at(150),
  },
];

export const adminDirectoryDriverDetailMock: Record<string, AdminDriverDirectoryDetail> = {
  [MOCK_DRIVER_ONLINE]: {
    ...adminDirectoryDriversMock[0]!,
    bookingsCount: 341,
    zoneRestrictions: [],
  },
  [MOCK_DRIVER_RESTRICTED]: {
    ...adminDirectoryDriversMock[1]!,
    bookingsCount: 96,
    zoneRestrictions: [{ zoneId: MOCK_ZONE_AIRPORT, name: 'Airport Corridor' }],
  },
  [MOCK_DRIVER_SUSPENDED]: {
    ...adminDirectoryDriversMock[2]!,
    bookingsCount: 12,
    zoneRestrictions: [],
  },
};

export const adminDirectoryDriverZonesMock = [
  { zoneId: MOCK_ZONE_SOUTH, name: 'South Zone' },
  { zoneId: MOCK_ZONE_NORTH, name: 'North Zone' },
  { zoneId: MOCK_ZONE_AIRPORT, name: 'Airport Corridor' },
];

export const adminDirectoryFleetsMock: AdminFleetDetail[] = [
  {
    id: MOCK_FLEET_BIG,
    businessName: 'Bengaluru Heavy Towing',
    status: 'active',
    gstin: '29ABCDE1234F1Z5',
    ownerId: MOCK_USER_ACTIVE,
    ownerName: 'Meera Iyer',
    ownerMobile: '+919845000001',
    driversCount: 24,
    onlineDriversCount: 11,
    trucksCount: 9,
    suspendedAt: null,
    suspensionReason: null,
    createdAt: at(400),
  },
  {
    id: MOCK_FLEET_SUSPENDED,
    businessName: 'Mysuru Quick Tow',
    status: 'suspended',
    gstin: null,
    ownerId: MOCK_USER_QUIET,
    ownerName: 'Asha Rao',
    ownerMobile: '+919845000003',
    driversCount: 4,
    onlineDriversCount: 0,
    trucksCount: 0,
    suspendedAt: at(6),
    suspensionReason: 'Operating without valid insurance',
    createdAt: at(210),
  },
];

export const adminDirectoryDriverBookingsMock: AdminDirectoryUserBookingsResponse = {
  items: adminDirectoryUserBookingsMock.items,
  page: 1,
  limit: 25,
  total: 2,
};

export const adminDirectoryZonesMock: AdminDirectoryZone[] = [
  { id: MOCK_ZONE_AIRPORT, name: 'Airport Corridor', isActive: false },
  { id: MOCK_ZONE_NORTH, name: 'North Zone', isActive: true },
  { id: MOCK_ZONE_SOUTH, name: 'South Zone', isActive: true },
];

/**
 * Mutable zone-restriction state, seeded from the fixtures. The real server's
 * save REFETCHES to the new set; a fixture that stayed static would make the
 * page's "Saved" state unreachable (the dirty check compares against the
 * refetched detail). One process-wide map is honest enough for mocks-on runs.
 */
export const mockDriverZoneStore = new Map<string, string[]>([
  [MOCK_DRIVER_RESTRICTED, [MOCK_ZONE_AIRPORT]],
  [MOCK_DRIVER_ONLINE, []],
  [MOCK_DRIVER_SUSPENDED, []],
]);

/** Zone refs for a driver, store-backed — the shape the detail route returns. */
export const mockDriverZoneRefs = (driverId: string): Array<{ zoneId: string; name: string }> =>
  (mockDriverZoneStore.get(driverId) ?? []).map((zoneId) => ({
    zoneId,
    name: adminDirectoryZonesMock.find((zone) => zone.id === zoneId)?.name ?? 'Unknown zone',
  }));

export const adminImpersonationMock: AdminImpersonationResponse = {
  session: {
    id: MOCK_IMPERSONATION_SESSION,
    adminId: id('61'),
    subjectType: 'user',
    subjectId: MOCK_USER_ACTIVE,
    reason: 'Investigating a support ticket',
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt: new Date(Date.now() + 1_680_000).toISOString(),
    endedAt: null,
  },
};

export const adminAppViewTripsMock: AdminAppViewTripsResponse = {
  items: adminDirectoryUserBookingsMock.items.map((booking) => ({
    id: booking.id,
    reference: `TW-${booking.id.slice(0, 8).toUpperCase()}`,
    status: booking.status,
    serviceSlug: 'car_tow',
    serviceType: booking.serviceType === 'battery' ? ('battery' as const) : ('tow' as const),
    vehicleClass: 'flatbed' as const,
    pickupAddress: 'Indiranagar, Bengaluru',
    pickup: { lat: 12.97, lng: 77.59 },
    dropAddress: 'Whitefield, Bengaluru',
    drop: { lat: 12.96, lng: 77.75 },
    distanceKm: 14.2,
    breakdown: {
      basePaise: booking.totalPaise,
      nightPaise: 0,
      highwayPaise: 0,
      accidentPaise: 0,
      surgePaise: 0,
      waitingPaise: 0,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: booking.totalPaise,
    },
    band: 'A',
    driver: null,
    scheduledAt: null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  })),
  nextCursor: null,
};

export const adminAppViewWalletMock: AdminAppViewWalletResponse = {
  wallet: { balancePaise: 25_000 },
  transactions: [
    {
      id: id('71'),
      amountPaise: 25_000,
      type: 'refund',
      reason: 'Cancellation refund',
      bookingId: id('101'),
      createdAt: at(2),
    },
    {
      id: id('72'),
      amountPaise: -145_000,
      type: 'payment',
      reason: 'Booking payment',
      bookingId: id('101'),
      createdAt: at(2),
    },
  ],
};

export const adminAppViewNotificationsMock = {
  items: [
    {
      id: id('81'),
      event: 'booking.completed',
      category: 'transactional' as const,
      title: 'Trip completed',
      body: 'Your car was delivered to Whitefield. Thanks for riding with us.',
      data: { bookingId: id('101') },
      readAt: null,
      createdAt: at(2),
    },
    {
      id: id('82'),
      event: 'payment.status',
      category: 'transactional' as const,
      title: 'Payment received',
      body: 'We received a payment for booking TW-00000101.',
      data: { bookingId: id('101') },
      readAt: at(1),
      createdAt: at(2),
    },
  ],
  nextCursor: null,
};

export const adminAppViewVehiclesMock = {
  items: [
    {
      id: id('91'),
      type: 'suv' as const,
      makeModel: 'Toyota Fortuner',
      plate: 'KA01AB1234',
      rcUrl: null,
      isDefault: true,
    },
    {
      id: id('92'),
      type: 'hatchback' as const,
      makeModel: 'Maruti Swift',
      plate: null,
      rcUrl: null,
      isDefault: false,
    },
  ],
};

export const adminAppViewAddressesMock = {
  items: [
    {
      id: id('95'),
      label: 'Home',
      fullAddress: '12 MG Road, Bengaluru',
      lat: 12.97,
      lng: 77.59,
      isDefault: true,
    },
    {
      id: id('96'),
      label: 'Office',
      fullAddress: 'Tower B, Whitefield',
      lat: 12.96,
      lng: 77.75,
      isDefault: false,
    },
  ],
};

export const adminUserSuspensionResultMock = {
  subjectId: MOCK_USER_ACTIVE,
  subjectType: 'user' as const,
  status: 'suspended' as const,
  cancelledSearchingBookings: 1,
};

export const adminDriverDecisionMock = (driverId: string): AdminDriverDecisionResponse => ({
  driverId,
  kycStatus: 'suspended',
  rejectionReason: null,
  sessionsRevoked: 1,
  suspensionPending: false,
});

export const adminFleetSuspensionMock = (fleetId: string): AdminFleetSuspensionResponse => ({
  fleetId,
  status: 'suspended',
  driverCount: adminDirectoryFleetsMock.find((fleet) => fleet.id === fleetId)?.driversCount ?? 0,
});

export const adminDriversDirectoryMock: AdminDriversDirectoryResponse = {
  items: adminDirectoryDriversMock,
  page: 1,
  limit: 25,
  total: adminDirectoryDriversMock.length,
};

export const adminFleetsDirectoryMock: AdminFleetsResponse = {
  items: adminDirectoryFleetsMock,
  page: 1,
  limit: 25,
  total: adminDirectoryFleetsMock.length,
};
