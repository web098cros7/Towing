import { env } from '@/lib/env';
import type { DriverCapabilitiesResponse, DriverCapabilitiesUpdate } from '../types';
import { capabilitiesMockSource } from './capabilitiesMockSource';
import { capabilitiesRestSource } from './capabilitiesRestSource';

/**
 * Boundary between UI and the driver capabilities endpoints
 * (`GET`/`PUT /driver/capabilities`).
 */
export interface CapabilitiesDataSource {
  /** What the driver is currently set to. */
  get(): Promise<DriverCapabilitiesResponse>;
  update(body: DriverCapabilitiesUpdate): Promise<DriverCapabilitiesResponse>;
}

export const capabilitiesDataSource: CapabilitiesDataSource = env.useMocks
  ? capabilitiesMockSource
  : capabilitiesRestSource;
