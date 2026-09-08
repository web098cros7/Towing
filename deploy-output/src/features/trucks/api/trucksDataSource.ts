import type { TrucksListResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { trucksMock } from '../mocks/trucks.mock';
import type { Truck } from '../types';

export interface TrucksDataSource {
  list(): Promise<Truck[]>;
}

const mockSource: TrucksDataSource = {
  list: () => resolveMock(env.mockTrucksState, trucksMock, []),
};

const restSource: TrucksDataSource = {
  // Fleets top out at dozens of trucks — one page covers the console table.
  list: async () => (await apiFetch<TrucksListResponse>('trucks?page=1&limit=100')).items,
};

export const trucksDataSource: TrucksDataSource = env.useMocks ? mockSource : restSource;
