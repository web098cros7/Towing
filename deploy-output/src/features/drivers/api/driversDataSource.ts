import type { DriversListResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { driversMock } from '../mocks/drivers.mock';
import type { FleetDriver } from '../types';

export interface DriversDataSource {
  list(): Promise<FleetDriver[]>;
}

const mockSource: DriversDataSource = {
  list: () => resolveMock(env.mockDriversState, driversMock, []),
};

const restSource: DriversDataSource = {
  list: async () => (await apiFetch<DriversListResponse>('drivers?page=1&limit=100')).items,
};

export const driversDataSource: DriversDataSource = env.useMocks ? mockSource : restSource;
