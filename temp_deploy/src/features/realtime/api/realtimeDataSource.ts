import type { PositionsSnapshotDto } from '@towing/api-contracts';
import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { mockSnapshot } from '../mocks/realtime.mock';
import type { PositionsSnapshot } from '../types';

export interface RealtimeDataSource {
  snapshot(): Promise<PositionsSnapshot>;
}

const emptySnapshot: PositionsSnapshot = {
  positions: [],
  zones: [],
  at: new Date(0).toISOString(),
  degraded: false,
};

const mockSource: RealtimeDataSource = {
  snapshot: () => resolveMock(env.mockRealtimeState, mockSnapshot(), emptySnapshot),
};

const restSource: RealtimeDataSource = {
  snapshot: async () => {
    const dto = await apiFetch<PositionsSnapshotDto>('realtime/positions');
    return {
      positions: dto.positions,
      zones: dto.zones as PositionsSnapshot['zones'],
      at: dto.at,
      degraded: dto.degraded,
    };
  },
};

export const realtimeDataSource: RealtimeDataSource = env.useMocks ? mockSource : restSource;
