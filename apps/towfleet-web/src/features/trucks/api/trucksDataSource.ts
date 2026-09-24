import type {
  TruckCreateRequest,
  TruckDto,
  TrucksListResponse,
  TruckUpdateRequest,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { trucksMock } from '../mocks/trucks.mock';
import type { Truck } from '../types';

export interface TrucksDataSource {
  list(): Promise<Truck[]>;
  create(input: TruckCreateRequest): Promise<Truck>;
  update(truckId: string, patch: TruckUpdateRequest): Promise<Truck>;
}

const mockSource: TrucksDataSource = {
  // A fresh array (and a fresh row on update) each read, so React Query sees a mock edit.
  list: () => resolveMock(env.mockTrucksState, [...trucksMock], []),
  create: async (input) => {
    await mockDelay();
    const truck: Truck = {
      id: `tr-${trucksMock.length + 1}`,
      plate: input.plate.toUpperCase(),
      type: input.type,
      make: input.make || null,
      model: input.model || null,
      capacityTons: input.capacityTons,
      status: 'active',
      assignedDriverName: null,
      currentLocation: null,
      lastPingAt: null,
      compliance: [],
    };
    trucksMock.push(truck);
    return truck;
  },
  update: async (truckId, patch) => {
    await mockDelay();
    const index = trucksMock.findIndex((t) => t.id === truckId);
    const truck = trucksMock[index];
    if (!truck) throw new Error('Truck not found');
    const next: Truck = {
      ...truck,
      make: patch.make === undefined ? truck.make : patch.make || null,
      model: patch.model === undefined ? truck.model : patch.model || null,
    };
    trucksMock[index] = next;
    return next;
  },
};

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const restSource: TrucksDataSource = {
  // Fleets top out at dozens of trucks — one page covers the console table.
  list: async () => (await apiFetch<TrucksListResponse>('trucks?page=1&limit=100')).items,
  create: (input) => apiFetch<TruckDto>('trucks', { method: 'POST', ...json(input) }),
  update: (truckId, patch) =>
    apiFetch<TruckDto>(`trucks/${encodeURIComponent(truckId)}`, { method: 'PUT', ...json(patch) }),
};

export const trucksDataSource: TrucksDataSource = env.useMocks ? mockSource : restSource;
