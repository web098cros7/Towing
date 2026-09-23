import type { DriversListResponse, FleetDriverPerformance } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { driverPerformanceMock, driversMock, mockShareOverrides } from '../mocks/drivers.mock';
import type { FleetDriver } from '../types';

export interface DriversDataSource {
  list(): Promise<FleetDriver[]>;
  /** ADM-23: one driver's trips, rates and earnings for this fleet. */
  performance(driverId: string): Promise<FleetDriverPerformance>;
  /** 0042: this driver's share, or null to follow the fleet's default. */
  updateShare(driverId: string, driverSharePct: number | null): Promise<void>;
}

const mockSource: DriversDataSource = {
  list: () => resolveMock(env.mockDriversState, driversMock, []),
  performance: async (driverId) => {
    const driver = driversMock.find((row) => row.id === driverId);
    if (!driver) throw new Error('Driver not found');
    const panel = driverPerformanceMock(driver);
    return resolveMock(env.mockDriversState, panel, panel);
  },
  updateShare: async (driverId, driverSharePct) => {
    await mockDelay();
    mockShareOverrides.set(driverId, driverSharePct);
  },
};

const restSource: DriversDataSource = {
  list: async () => (await apiFetch<DriversListResponse>('drivers?page=1&limit=100')).items,
  performance: (driverId) =>
    apiFetch<FleetDriverPerformance>(`drivers/${encodeURIComponent(driverId)}/performance`),
  updateShare: async (driverId, driverSharePct) => {
    await apiFetch(`drivers/${encodeURIComponent(driverId)}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverSharePct }),
    });
  },
};

export const driversDataSource: DriversDataSource = env.useMocks ? mockSource : restSource;
