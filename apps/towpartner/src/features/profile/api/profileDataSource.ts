import { env } from '@/lib/env';
import type { DriverProfile as DriverMe } from '@towing/api-contracts';
import type { DriverProfile } from '../types';
import { profileMockSource } from './profileMockSource';
import { profileRestSource } from './profileRestSource';

/**
 * Boundary between UI and backend. Selected by `env.useMocks` — the same
 * switch every other feature uses — so query hooks and components never know
 * which one they are talking to.
 */
export interface ProfileDataSource {
  getProfile(): Promise<DriverProfile>;
  /** The raw `driver/me` contract, for Personal Information. */
  getMe(): Promise<DriverMe>;
}

export const profileDataSource: ProfileDataSource = env.useMocks
  ? profileMockSource
  : profileRestSource;
