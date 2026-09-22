import type { CustomerProfile } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { ProfileDataSource } from './profileDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seeded from the signed-in identity so mock mode reflects whoever just verified OTP. */
function seedProfile(): CustomerProfile {
  const identity = useAuthStore.getState().identity;
  return {
    id: identity?.id ?? 'mock-customer-1',
    mobile: identity?.mobile ?? '+919876543210',
    name: identity?.name ?? 'Rahul Sharma',
    email: 'rahul.sharma@email.com',
    photoUrl: null,
    language: null,
    appearance: null,
  };
}

let mockProfile: CustomerProfile | null = null;

export const profileMockSource: ProfileDataSource = {
  async getProfile() {
    await delay(400);
    if (env.mockAccountState === 'error') {
      throw new Error('Failed to load profile');
    }
    if (!mockProfile) mockProfile = seedProfile();
    return mockProfile;
  },

  async updateProfile(patch) {
    await delay(400);
    if (!mockProfile) mockProfile = seedProfile();
    mockProfile = { ...mockProfile, ...patch };
    return mockProfile;
  },
};
