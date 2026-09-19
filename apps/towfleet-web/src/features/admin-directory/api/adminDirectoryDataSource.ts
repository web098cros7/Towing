import type {
  AdminAppViewAddressesResponse,
  AdminAppViewNotificationsResponse,
  AdminAppViewTripsResponse,
  AdminAppViewVehiclesResponse,
  AdminAppViewWalletResponse,
  AdminDirectorySuspendResponse,
  AdminDirectoryUserBookingsResponse,
  AdminDirectoryUserDetail,
  AdminDirectoryUsersResponse,
  AdminDirectoryZonesResponse,
  AdminDriverBookingsResponse,
  AdminDriverDecisionResponse,
  AdminDriverDirectoryDetail,
  AdminDriverSuspendBody,
  AdminDriverZonesResponse,
  AdminDriversDirectoryQuery,
  AdminDriversDirectoryResponse,
  AdminFleetDetail,
  AdminFleetSuspensionResponse,
  AdminFleetsQuery,
  AdminFleetsResponse,
  AdminImpersonationResponse,
  AdminSuspensionRequest,
  AdminSuspensionRequestsResponse,
  DriversListResponse,
  EarningsSummaryDto,
  PageQuery,
  TrucksListResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  adminAppViewAddressesMock,
  adminAppViewNotificationsMock,
  adminAppViewTripsMock,
  adminAppViewVehiclesMock,
  adminAppViewWalletMock,
  adminDirectoryDriverBookingsMock,
  adminDirectoryDriverDetailMock,
  adminDirectoryDriverZonesMock,
  adminDirectoryDriversMock,
  adminDirectoryFleetsMock,
  adminDirectoryUserBookingsMock,
  adminDirectoryUserDetailMock,
  adminDirectoryUsersMock,
  adminDirectoryZonesMock,
  adminDriverDecisionMock,
  mockDriverZoneRefs,
  mockDriverZoneStore,
  adminDriversDirectoryMock,
  adminFleetSuspensionMock,
  adminFleetsDirectoryMock,
  adminImpersonationMock,
  adminSuspensionRequestsMock,
  adminUserSuspensionResultMock,
  MOCK_DRIVER_ONLINE,
  MOCK_FLEET_BIG,
  MOCK_USER_ACTIVE,
} from '../mocks/adminDirectory.mock';

/**
 * W6's directory API — the only place the pages talk to the backend.
 *
 * Every method is one published contract type; the mock branch mirrors the
 * real responses so the e2e suite exercises the same components the backend
 * feeds. Mutations return plausible results and do NOT mutate the mock arrays
 * (the mock is a constant, and a page that only looks right after a second
 * fetch is right by accident — screens must render from the entered value).
 */
export interface AdminDirectoryDataSource {
  users(query: { q?: string; status?: string; page: number; limit: number }): Promise<AdminDirectoryUsersResponse>;
  user(userId: string): Promise<AdminDirectoryUserDetail>;
  userBookings(userId: string, query: PageQuery): Promise<AdminDirectoryUserBookingsResponse>;
  suspendUser(userId: string, reason: string): Promise<AdminDirectorySuspendResponse>;
  reactivateUser(userId: string): Promise<AdminDirectorySuspendResponse>;
  suspensionRequests(status?: string): Promise<AdminSuspensionRequestsResponse>;
  approveRequest(requestId: string, note?: string): Promise<AdminSuspensionRequest>;
  rejectRequest(requestId: string, note?: string): Promise<AdminSuspensionRequest>;

  drivers(query: Partial<AdminDriversDirectoryQuery>): Promise<AdminDriversDirectoryResponse>;
  driver(driverId: string): Promise<AdminDriverDirectoryDetail>;
  driverBookings(driverId: string, query: PageQuery): Promise<AdminDriverBookingsResponse>;
  suspendDriver(driverId: string, body: AdminDriverSuspendBody): Promise<AdminDriverDecisionResponse>;
  reactivateDriver(driverId: string): Promise<AdminDriverDecisionResponse>;
  updateDriverZones(driverId: string, zoneIds: string[]): Promise<AdminDriverZonesResponse>;

  fleets(query: Partial<AdminFleetsQuery>): Promise<AdminFleetsResponse>;
  fleet(fleetId: string): Promise<AdminFleetDetail>;
  fleetTrucks(fleetId: string, query: PageQuery): Promise<TrucksListResponse>;
  fleetDrivers(fleetId: string, query: PageQuery): Promise<DriversListResponse>;
  fleetEarnings(fleetId: string): Promise<EarningsSummaryDto>;
  suspendFleet(fleetId: string, reason: string): Promise<AdminFleetSuspensionResponse>;
  reactivateFleet(fleetId: string): Promise<AdminFleetSuspensionResponse>;

  zones(): Promise<AdminDirectoryZonesResponse>;

  impersonate(userId: string, reason: string): Promise<AdminImpersonationResponse>;
  endImpersonation(userId: string, sessionId: string): Promise<AdminImpersonationResponse>;
  appViewTrips(userId: string, session: string): Promise<AdminAppViewTripsResponse>;
  appViewWallet(userId: string, session: string): Promise<AdminAppViewWalletResponse>;
  appViewNotifications(userId: string, session: string): Promise<AdminAppViewNotificationsResponse>;
  appViewVehicles(userId: string, session: string): Promise<AdminAppViewVehiclesResponse>;
  appViewAddresses(userId: string, session: string): Promise<AdminAppViewAddressesResponse>;
}

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
};

const mockSource: AdminDirectoryDataSource = {
  users: (query) =>
    resolveMock(
      env.mockAdminDirectoryState,
      {
        items: adminDirectoryUsersMock.filter((user) => {
          if (query.status && user.status !== query.status) return false;
          if (!query.q) return true;
          const probe = query.q.toLowerCase();
          return user.name?.toLowerCase().includes(probe) ?? user.mobile.includes(probe);
        }),
        page: query.page,
        limit: query.limit,
        total: adminDirectoryUsersMock.length,
      },
      { items: [], page: 1, limit: query.limit, total: 0 },
    ),
  user: async (userId) => {
    await mockDelay();
    return (
      adminDirectoryUserDetailMock[userId] ?? {
        ...adminDirectoryUsersMock[0]!,
        id: userId,
        bookingsCount: 0,
      }
    );
  },
  userBookings: () => resolveMock(env.mockAdminDirectoryState, adminDirectoryUserBookingsMock, { ...adminDirectoryUserBookingsMock, items: [], total: 0 }),
  suspendUser: async (userId) => {
    await mockDelay();
    return { ...adminUserSuspensionResultMock, subjectId: userId };
  },
  reactivateUser: async (userId) => {
    await mockDelay();
    return { ...adminUserSuspensionResultMock, subjectId: userId, status: 'active', cancelledSearchingBookings: 0 };
  },
  suspensionRequests: (status) =>
    resolveMock(
      env.mockAdminDirectoryState,
      { items: adminSuspensionRequestsMock.filter((request) => !status || request.status === status) },
      { items: [] },
    ),
  approveRequest: async (requestId, note) => {
    await mockDelay();
    const request = adminSuspensionRequestsMock.find((row) => row.id === requestId)!;
    return { ...request, status: 'approved', decidedAt: new Date().toISOString(), decisionNote: note ?? null };
  },
  rejectRequest: async (requestId, note) => {
    await mockDelay();
    const request = adminSuspensionRequestsMock.find((row) => row.id === requestId)!;
    return { ...request, status: 'rejected', decidedAt: new Date().toISOString(), decisionNote: note ?? null };
  },

  drivers: (query) =>
    resolveMock(
      env.mockAdminDirectoryState,
      {
        items: adminDirectoryDriversMock.filter((driver) => {
          if (query.online !== undefined && driver.isOnline !== query.online) return false;
          if (query.kycStatus && driver.kycStatus !== query.kycStatus) return false;
          if (!query.q) return true;
          const probe = query.q.toLowerCase();
          return driver.name?.toLowerCase().includes(probe) ?? driver.mobile.includes(probe);
        }),
        page: query.page ?? 1,
        limit: query.limit ?? 25,
        total: adminDirectoryDriversMock.length,
      },
      { items: [], page: 1, limit: 25, total: 0 },
    ),
  driver: async (driverId) => {
    await mockDelay();
    const base = adminDirectoryDriverDetailMock[driverId] ?? adminDirectoryDriverDetailMock[MOCK_DRIVER_ONLINE]!;
    return { ...base, id: driverId, zoneRestrictions: mockDriverZoneRefs(driverId) };
  },
  driverBookings: () => resolveMock(env.mockAdminDirectoryState, adminDirectoryDriverBookingsMock, { ...adminDirectoryDriverBookingsMock, items: [], total: 0 }),
  suspendDriver: async (driverId) => {
    await mockDelay();
    return adminDriverDecisionMock(driverId);
  },
  reactivateDriver: async (driverId) => {
    await mockDelay();
    return { ...adminDriverDecisionMock(driverId), kycStatus: 'pending', sessionsRevoked: 0 };
  },
  updateDriverZones: async (driverId, zoneIds) => {
    await mockDelay();
    mockDriverZoneStore.set(driverId, [...zoneIds]);
    return { driverId, zoneRestrictions: mockDriverZoneRefs(driverId) };
  },

  fleets: (query) =>
    resolveMock(
      env.mockAdminDirectoryState,
      {
        items: adminDirectoryFleetsMock.filter((fleet) => {
          if (query.status && fleet.status !== query.status) return false;
          if (!query.q) return true;
          return fleet.businessName.toLowerCase().includes(query.q.toLowerCase());
        }),
        page: query.page ?? 1,
        limit: query.limit ?? 25,
        total: adminDirectoryFleetsMock.length,
      },
      { items: [], page: 1, limit: 25, total: 0 },
    ),
  fleet: async (fleetId) => {
    await mockDelay();
    return adminDirectoryFleetsMock.find((fleet) => fleet.id === fleetId) ?? adminDirectoryFleetsMock[0]!;
  },
  fleetTrucks: async () => {
    await mockDelay();
    return {
      items: [
        {
          id: '00000000-0000-4000-8000-000000000201',
          plate: 'KA01XY9999',
          type: 'flatbed' as const,
          capacityTons: 3,
          status: 'active' as const,
          assignedDriverName: 'Kiran Shetty',
          currentLocation: null,
          lastPingAt: null,
          compliance: [],
        },
      ],
      page: 1,
      limit: 25,
      total: 1,
    };
  },
  fleetDrivers: async () => {
    await mockDelay();
    return {
      items: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          name: 'Kiran Shetty',
          phone: '+919845000011',
          kycStatus: 'approved' as const,
          isOnline: true,
          assignedTruckPlate: 'KA01XY9999',
          rating: 4.6,
          tripsTotal: 341,
          monthNetPaise: 246_500,
        },
        {
          id: '00000000-0000-4000-8000-000000000013',
          name: 'Deepak Verma',
          phone: '+919845000013',
          kycStatus: 'suspended' as const,
          isOnline: false,
          assignedTruckPlate: null,
          rating: 3.2,
          tripsTotal: 12,
          monthNetPaise: 0,
        },
      ],
      page: 1,
      limit: 25,
      total: 2,
    };
  },
  fleetEarnings: async () => {
    await mockDelay();
    const today = new Date().toISOString().slice(0, 10);
    return {
      period: { from: today, to: today },
      wallet: {
        balancePaise: 540_000,
        availablePaise: 500_000,
        minPayoutPaise: 100_000,
        maxPayoutPaise: 5_000_000,
        payoutAccountLinked: true,
      },
      totals: {
        jobs: 18,
        grossPaise: 1_450_000,
        commissionPaise: 217_500,
        poolPaise: 1_232_500,
        driverSharePaise: 986_000,
        fleetSharePaise: 246_500,
      },
      trend: [],
    };
  },
  suspendFleet: async (fleetId) => {
    await mockDelay();
    return adminFleetSuspensionMock(fleetId);
  },
  reactivateFleet: async (fleetId) => {
    await mockDelay();
    return { ...adminFleetSuspensionMock(fleetId), status: 'active' };
  },

  zones: () => resolveMock(env.mockAdminDirectoryState, { items: adminDirectoryZonesMock }, { items: [] }),

  impersonate: async (userId, reason) => {
    await mockDelay();
    return {
      session: { ...adminImpersonationMock.session, subjectId: userId, reason },
    };
  },
  endImpersonation: async (userId, sessionId) => {
    await mockDelay();
    return {
      session: { ...adminImpersonationMock.session, id: sessionId, subjectId: userId, endedAt: new Date().toISOString() },
    };
  },
  appViewTrips: () => resolveMock(env.mockAdminDirectoryState, adminAppViewTripsMock, { items: [], nextCursor: null }),
  appViewWallet: () => resolveMock(env.mockAdminDirectoryState, adminAppViewWalletMock, { wallet: { balancePaise: 0 }, transactions: [] }),
  appViewNotifications: () => resolveMock(env.mockAdminDirectoryState, adminAppViewNotificationsMock, { items: [], nextCursor: null }),
  appViewVehicles: () => resolveMock(env.mockAdminDirectoryState, adminAppViewVehiclesMock, { items: [] }),
  appViewAddresses: () => resolveMock(env.mockAdminDirectoryState, adminAppViewAddressesMock, { items: [] }),
};

const restSource: AdminDirectoryDataSource = {
  users: (query) =>
    adminApiFetch<AdminDirectoryUsersResponse>(
      `users${qs({ q: query.q, status: query.status, page: query.page, limit: query.limit })}`,
    ),
  user: (userId) => adminApiFetch<AdminDirectoryUserDetail>(`users/${userId}`),
  userBookings: (userId, query) =>
    adminApiFetch<AdminDirectoryUserBookingsResponse>(
      `users/${userId}/bookings${qs({ page: query.page, limit: query.limit })}`,
    ),
  suspendUser: (userId, reason) =>
    adminApiFetch<AdminDirectorySuspendResponse>(`users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reactivateUser: (userId) =>
    adminApiFetch<AdminDirectorySuspendResponse>(`users/${userId}/reactivate`, { method: 'POST' }),
  suspensionRequests: (status) =>
    adminApiFetch<AdminSuspensionRequestsResponse>(`suspension-requests${qs({ status })}`),
  approveRequest: (requestId, note) =>
    adminApiFetch<AdminSuspensionRequest>(`suspension-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ ...(note ? { note } : {}) }),
    }),
  rejectRequest: (requestId, note) =>
    adminApiFetch<AdminSuspensionRequest>(`suspension-requests/${requestId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ ...(note ? { note } : {}) }),
    }),

  drivers: (query) =>
    adminApiFetch<AdminDriversDirectoryResponse>(
      `drivers${qs({
        q: query.q,
        kycStatus: query.kycStatus,
        online: query.online === undefined ? undefined : String(query.online),
        longDistance: query.longDistance === undefined ? undefined : String(query.longDistance),
        zoneId: query.zoneId,
        fleetId: query.fleetId,
        vehicleClass: query.vehicleClass,
        minRating: query.minRating,
        page: query.page,
        limit: query.limit,
      })}`,
    ),
  driver: (driverId) => adminApiFetch<AdminDriverDirectoryDetail>(`drivers/${driverId}`),
  driverBookings: (driverId, query) =>
    adminApiFetch<AdminDriverBookingsResponse>(
      `drivers/${driverId}/bookings${qs({ page: query.page, limit: query.limit })}`,
    ),
  suspendDriver: (driverId, body) =>
    adminApiFetch<AdminDriverDecisionResponse>(`drivers/${driverId}/suspend`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reactivateDriver: (driverId) =>
    adminApiFetch<AdminDriverDecisionResponse>(`drivers/${driverId}/reactivate`, { method: 'POST' }),
  updateDriverZones: (driverId, zoneIds) =>
    adminApiFetch<AdminDriverZonesResponse>(`drivers/${driverId}/zones`, {
      method: 'PUT',
      body: JSON.stringify({ zoneIds }),
    }),

  fleets: (query) =>
    adminApiFetch<AdminFleetsResponse>(
      `fleets${qs({ q: query.q, status: query.status, page: query.page, limit: query.limit })}`,
    ),
  fleet: (fleetId) => adminApiFetch<AdminFleetDetail>(`fleets/${fleetId}`),
  fleetTrucks: (fleetId, query) =>
    adminApiFetch<TrucksListResponse>(`fleets/${fleetId}/trucks${qs({ page: query.page, limit: query.limit })}`),
  fleetDrivers: (fleetId, query) =>
    adminApiFetch<DriversListResponse>(`fleets/${fleetId}/drivers${qs({ page: query.page, limit: query.limit })}`),
  fleetEarnings: (fleetId) => adminApiFetch<EarningsSummaryDto>(`fleets/${fleetId}/earnings`),
  suspendFleet: (fleetId, reason) =>
    adminApiFetch<AdminFleetSuspensionResponse>(`fleets/${fleetId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reactivateFleet: (fleetId) =>
    adminApiFetch<AdminFleetSuspensionResponse>(`fleets/${fleetId}/reactivate`, { method: 'POST' }),

  zones: () => adminApiFetch<AdminDirectoryZonesResponse>('directory/zones'),

  impersonate: (userId, reason) =>
    adminApiFetch<AdminImpersonationResponse>(`users/${userId}/impersonate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  endImpersonation: (userId, sessionId) =>
    adminApiFetch<AdminImpersonationResponse>(`users/${userId}/impersonate/end`, {
      method: 'POST',
      body: JSON.stringify({ session: sessionId }),
    }),
  appViewTrips: (userId, session) =>
    adminApiFetch<AdminAppViewTripsResponse>(`users/${userId}/app-view/trips${qs({ session })}`),
  appViewWallet: (userId, session) =>
    adminApiFetch<AdminAppViewWalletResponse>(`users/${userId}/app-view/wallet${qs({ session })}`),
  appViewNotifications: (userId, session) =>
    adminApiFetch<AdminAppViewNotificationsResponse>(`users/${userId}/app-view/notifications${qs({ session })}`),
  appViewVehicles: (userId, session) =>
    adminApiFetch<AdminAppViewVehiclesResponse>(`users/${userId}/app-view/vehicles${qs({ session })}`),
  appViewAddresses: (userId, session) =>
    adminApiFetch<AdminAppViewAddressesResponse>(`users/${userId}/app-view/addresses${qs({ session })}`),
};

export const adminDirectoryDataSource: AdminDirectoryDataSource = env.useMocks
  ? mockSource
  : restSource;
