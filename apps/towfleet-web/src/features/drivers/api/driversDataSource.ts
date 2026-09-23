import type { DriversListResponse, FleetDriverPerformance } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { driverPerformanceMock, driversMock } from '../mocks/drivers.mock';
import type { FleetDriver } from '../types';

export interface DriversDataSource {
  list(): Promise<FleetDriver[]>;
  /** ADM-23: one driver's trips, rates and earnings for this fleet. */
  performance(driverId: string): Promise<FleetDriverPerformance>;
}

const mockSource: DriversDataSource = {
  list: () => resolveMock(env.mockDriversState, driversMock, []),
  performance: async (driverId) => {
    const driver = driversMock.find((row) => row.id === driverId);
    if (!driver) throw new Error('Driver not found');
    const panel = driverPerformanceMock(driver);
    return resolveMock(env.mockDriversState, panel, panel);
  },
};

const restSource: DriversDataSource = {
  list: async () => (await apiFetch<DriversListResponse>('drivers?page=1&limit=100')).items,
  performance: (driverId) =>
    apiFetch<FleetDriverPerformance>(`drivers/${encodeURIComponent(driverId)}/performance`),
};

export const driversDataSource: DriversDataSource = env.useMocks ? mockSource : restSource;
