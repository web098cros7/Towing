import { env } from '@/lib/env';
import type {
  DriverPhotoPresignResponse,
  DriverProfile as DriverMe,
  DriverProfileUpdate,
  DriverTruck,
} from '@towing/api-contracts';
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
  /** The driver's truck and its papers, for Insurance. */
  getTruck(): Promise<DriverTruck>;
  /** The three fields a driver may change about themselves. */
  updateMe(patch: DriverProfileUpdate): Promise<DriverMe>;
  presignPhoto(): Promise<DriverPhotoPresignResponse>;
  confirmPhoto(key: string): Promise<DriverMe>;
}

export const profileDataSource: ProfileDataSource = env.useMocks
  ? profileMockSource
  : profileRestSource;
