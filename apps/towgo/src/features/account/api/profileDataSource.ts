import type { CustomerProfile, CustomerProfileUpdate } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { profileMockSource } from './profileMockSource';
import { profileRestSource } from './profileRestSource';

export interface PresignedPhotoUpload {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

export interface ProfileDataSource {
  getProfile(): Promise<CustomerProfile>;
  updateProfile(patch: CustomerProfileUpdate): Promise<CustomerProfile>;
  presignPhoto(): Promise<PresignedPhotoUpload>;
  confirmPhoto(key: string, localUri?: string): Promise<CustomerProfile>;
}

export const profileDataSource: ProfileDataSource = env.useMocks ? profileMockSource : profileRestSource;
