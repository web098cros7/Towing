import { useQuery } from '@tanstack/react-query';
import type { AdminDriversDirectoryQuery, AdminFleetsQuery } from '@towing/api-contracts';
import { adminDirectoryKeys, type AppViewSection } from './adminDirectory.keys';
import { adminDirectoryDataSource } from './adminDirectoryDataSource';

export function useAdminDirectoryUsers(query: {
  q?: string;
  status?: string;
  page: number;
  limit: number;
}) {
  return useQuery({
    queryKey: adminDirectoryKeys.users(query),
    queryFn: () => adminDirectoryDataSource.users(query),
  });
}

export function useAdminDirectoryUser(userId: string | null) {
  return useQuery({
    queryKey: adminDirectoryKeys.user(userId ?? ''),
    queryFn: () => adminDirectoryDataSource.user(userId!),
    enabled: userId !== null,
  });
}

export function useAdminDirectoryUserBookings(userId: string | null, page: number) {
  return useQuery({
    queryKey: adminDirectoryKeys.userBookings(userId ?? '', page),
    queryFn: () => adminDirectoryDataSource.userBookings(userId!, { page, limit: 25 }),
    enabled: userId !== null,
  });
}

export function useAdminSuspensionRequests(status?: string) {
  return useQuery({
    queryKey: adminDirectoryKeys.requests(status),
    queryFn: () => adminDirectoryDataSource.suspensionRequests(status),
  });
}

export function useAdminDirectoryDrivers(query: Partial<AdminDriversDirectoryQuery>) {
  return useQuery({
    queryKey: adminDirectoryKeys.drivers(query as Record<string, unknown>),
    queryFn: () => adminDirectoryDataSource.drivers(query),
  });
}

export function useAdminDirectoryDriver(driverId: string | null) {
  return useQuery({
    queryKey: adminDirectoryKeys.driver(driverId ?? ''),
    queryFn: () => adminDirectoryDataSource.driver(driverId!),
    enabled: driverId !== null,
  });
}

export function useAdminDirectoryDriverBookings(driverId: string | null, page: number) {
  return useQuery({
    queryKey: adminDirectoryKeys.driverBookings(driverId ?? '', page),
    queryFn: () => adminDirectoryDataSource.driverBookings(driverId!, { page, limit: 25 }),
    enabled: driverId !== null,
  });
}

export function useAdminDirectoryFleets(query: Partial<AdminFleetsQuery>) {
  return useQuery({
    queryKey: adminDirectoryKeys.fleets(query as Record<string, unknown>),
    queryFn: () => adminDirectoryDataSource.fleets(query),
  });
}

export function useAdminDirectoryFleet(fleetId: string | null) {
  return useQuery({
    queryKey: adminDirectoryKeys.fleet(fleetId ?? ''),
    queryFn: () => adminDirectoryDataSource.fleet(fleetId!),
    enabled: fleetId !== null,
  });
}

export function useAdminDirectoryFleetTrucks(fleetId: string | null, page: number) {
  return useQuery({
    queryKey: adminDirectoryKeys.fleetTrucks(fleetId ?? '', page),
    queryFn: () => adminDirectoryDataSource.fleetTrucks(fleetId!, { page, limit: 25 }),
    enabled: fleetId !== null,
  });
}

export function useAdminDirectoryFleetDrivers(fleetId: string | null, page: number) {
  return useQuery({
    queryKey: adminDirectoryKeys.fleetDrivers(fleetId ?? '', page),
    queryFn: () => adminDirectoryDataSource.fleetDrivers(fleetId!, { page, limit: 25 }),
    enabled: fleetId !== null,
  });
}

export function useAdminDirectoryFleetEarnings(fleetId: string | null) {
  return useQuery({
    queryKey: adminDirectoryKeys.fleetEarnings(fleetId ?? ''),
    queryFn: () => adminDirectoryDataSource.fleetEarnings(fleetId!),
    enabled: fleetId !== null,
  });
}

export function useAdminDirectoryZones() {
  return useQuery({
    queryKey: adminDirectoryKeys.zones(),
    queryFn: () => adminDirectoryDataSource.zones(),
  });
}

export function useAdminAppView<T>(
  userId: string | null,
  section: AppViewSection,
  session: string | null,
) {
  return useQuery({
    queryKey: adminDirectoryKeys.appView(userId ?? '', section, session ?? ''),
    queryFn: async () => {
      const source = adminDirectoryDataSource;
      switch (section) {
        case 'trips':
          return (await source.appViewTrips(userId!, session!)) as T;
        case 'wallet':
          return (await source.appViewWallet(userId!, session!)) as T;
        case 'notifications':
          return (await source.appViewNotifications(userId!, session!)) as T;
        case 'vehicles':
          return (await source.appViewVehicles(userId!, session!)) as T;
        case 'addresses':
          return (await source.appViewAddresses(userId!, session!)) as T;
      }
    },
    enabled: userId !== null && session !== null,
  });
}
