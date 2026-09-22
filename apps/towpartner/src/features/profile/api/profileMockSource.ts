import { env } from '@/lib/env';
import type {
  DriverPhotoPresignResponse,
  DriverProfile as DriverMe,
  DriverProfileUpdate,
  DriverTruck,
} from '@towing/api-contracts';
import type { ProfileDataSource } from './profileDataSource';
import type { DriverProfile } from '../types';
import { profileMock } from '../mocks/profile.mock';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Edits made through the mock stick across reads, so a save is visible on refetch. */
let mockOverrides: Partial<DriverMe> = {};

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

  async getTruck(): Promise<DriverTruck> {
    await delay(500);
    if (env.mockProfileState === 'error') {
      throw new Error('Failed to load profile');
    }
    return mockTruck();
  },

  async updateMe(patch: DriverProfileUpdate): Promise<DriverMe> {
    await delay(500);
    if (env.mockProfileState === 'error') {
      throw new Error('Failed to load profile');
    }
    mockOverrides = { ...mockOverrides, ...patch };
    return mockMe();
  },

  async presignPhoto(): Promise<DriverPhotoPresignResponse> {
    await delay(500);
    if (env.mockProfileState === 'error') {
      throw new Error('Failed to load profile');
    }
    return {
      uploadUrl: 'mock://driver-photos/photo',
      key: 'mock-photo-key',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  },

  async confirmPhoto(_key: string): Promise<DriverMe> {
    await delay(500);
    if (env.mockProfileState === 'error') {
      throw new Error('Failed to load profile');
    }
    mockOverrides.photoUrl = 'https://mock.towing.dev/driver-photo.jpg';
    return mockMe();
  },
};

/**
 * A plausible `driver/truck` matching `mockMe()`'s truck, showing the states
 * that matter: a non-compliant truck because insurance is expired, an RC that
 * is fine, a PUC about to lapse, and a permit that was never uploaded. The
 * server sorts documents insurance-first; the mock must not disagree.
 */
function mockTruck(): DriverTruck {
  const now = Date.now();
  const days = (n: number) => new Date(now + n * 86_400_000).toISOString();
  return {
    truck: {
      id: '22222222-2222-4222-8222-222222222222',
      plate: 'KA 01 AB 1234',
      make: 'Tata',
      model: 'Ultra',
      vehicleClass: 'flatbed',
      status: 'non_compliant',
    },
    fleetName: 'Bengaluru Towing Co.',
    documents: [
      {
        id: 'doc-insurance',
        docType: 'insurance',
        issuedAt: days(-405),
        expiresAt: days(-40),
        status: 'expired',
      },
      {
        id: 'doc-rc',
        docType: 'rc',
        issuedAt: days(-900),
        expiresAt: days(240),
        status: 'valid',
      },
      {
        id: 'doc-puc',
        docType: 'puc',
        issuedAt: days(-170),
        expiresAt: days(12),
        status: 'expiring',
      },
      {
        id: 'doc-permit',
        docType: 'permit',
        issuedAt: null,
        expiresAt: null,
        status: 'missing',
      },
    ],
  };
}

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
    email: null,
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
    ...mockOverrides,
  };
}
