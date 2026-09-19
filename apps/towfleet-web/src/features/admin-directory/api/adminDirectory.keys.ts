export const adminDirectoryKeys = {
  all: ['admin-directory'] as const,

  users: (query: { q?: string; status?: string; page: number; limit: number }) =>
    [...adminDirectoryKeys.all, 'users', query] as const,
  user: (userId: string) => [...adminDirectoryKeys.all, 'user', userId] as const,
  userBookings: (userId: string, page: number) =>
    [...adminDirectoryKeys.all, 'user-bookings', userId, page] as const,

  requests: (status?: string) => [...adminDirectoryKeys.all, 'requests', status ?? 'open'] as const,

  drivers: (query: Record<string, unknown>) =>
    [...adminDirectoryKeys.all, 'drivers', query] as const,
  driver: (driverId: string) => [...adminDirectoryKeys.all, 'driver', driverId] as const,
  driverBookings: (driverId: string, page: number) =>
    [...adminDirectoryKeys.all, 'driver-bookings', driverId, page] as const,

  fleets: (query: Record<string, unknown>) =>
    [...adminDirectoryKeys.all, 'fleets', query] as const,
  fleet: (fleetId: string) => [...adminDirectoryKeys.all, 'fleet', fleetId] as const,
  fleetTrucks: (fleetId: string, page: number) =>
    [...adminDirectoryKeys.all, 'fleet-trucks', fleetId, page] as const,
  fleetDrivers: (fleetId: string, page: number) =>
    [...adminDirectoryKeys.all, 'fleet-drivers', fleetId, page] as const,
  fleetEarnings: (fleetId: string) =>
    [...adminDirectoryKeys.all, 'fleet-earnings', fleetId] as const,

  zones: () => [...adminDirectoryKeys.all, 'zones'] as const,

  appView: (userId: string, section: string, session: string) =>
    [...adminDirectoryKeys.all, 'app-view', userId, section, session] as const,
};

export const APP_VIEW_SECTIONS = [
  'trips',
  'wallet',
  'notifications',
  'vehicles',
  'addresses',
] as const;
export type AppViewSection = (typeof APP_VIEW_SECTIONS)[number];
