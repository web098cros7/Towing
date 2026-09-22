import type { CustomerProfile } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { PresignedPhotoUpload, ProfileDataSource } from './profileDataSource';

export const profileRestSource: ProfileDataSource = {
  getProfile() {
    return apiFetch<CustomerProfile>('me');
  },

  updateProfile(patch) {
    return apiFetch<CustomerProfile>('me', {
      method: 'PUT',
      body: JSON.stringify(patch),
      idempotent: true,
    });
  },

  presignPhoto() {
    return apiFetch<PresignedPhotoUpload>('me/photo/presign', {
      method: 'POST',
      idempotent: true,
    });
  },

  confirmPhoto(key) {
    return apiFetch<CustomerProfile>('me/photo/confirm', {
      method: 'POST',
      body: JSON.stringify({ key }),
      idempotent: true,
    });
  },
};
