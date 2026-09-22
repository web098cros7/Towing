import { env } from '@/lib/env';
import type { DriverProfile as DriverMe } from '@towing/api-contracts';
import type { ProfileDataSource } from './profileDataSource';
import type { DriverProfile } from '../types';
import { profileMock } from '../mocks/profile.mock';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock profile with realistic latency. `EXPO_PUBLIC_MOCK_PROFILE_STATE`
 * forces error so the §10.9 state can be exercised without a backend.
 */
export const profileMockSource: ProfileDataSource = {
  async getProfile(): Promise<DriverProfile> {
    await delay(500);
    if (env.mockProfileState === 'error') {
      throw new Error('Failed to load profile');
    }
    return profileMock;
  },

  async getMe(): Promise<DriverMe> {
    await delay(500);
    if (env.mockProfileState === 'error') {
      throw new Error('Failed to load profile');
    }
    return mockMe();
  },
};

/**
 * A plausible `driver/me` built from the profile mock, so Personal Information
 * has something to render without a backend. The id is a fixed uuid so the
 * derived `DRV-…` reference is stable across reloads.
 */
function mockMe(): DriverMe {
  const memberSince = new Date(Date.now() - 18 * 30 * 86_400_000).toISOString();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: profileMock.name,
    mobile: profileMock.phone,
    photoUrl: profileMock.avatar,
    rating: profileMock.stats.rating,
    totalTrips: profileMock.stats.jobsCompleted,
    acceptanceRatePct: 92,
    completionRatePct: profileMock.stats.completionPercent,
    level: 'gold',
    kycStatus: profileMock.verified ? 'approved' : 'pending',
    memberSince,
    fleet: null,
    truck: {
      plate: 'KA 01 AB 1234',
      make: 'Tata',
      model: 'Ultra',
      vehicleClass: 'flatbed',
    },
  };
}
