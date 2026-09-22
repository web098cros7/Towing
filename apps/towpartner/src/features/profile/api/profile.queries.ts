import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverProfileUpdate } from '@towing/api-contracts';
import { profileDataSource } from './profileDataSource';
import { profileKeys } from './profile.keys';
import { DocPickCancelled, MAX_UPLOAD_BYTES, pickAndCompress } from '@/features/kyc/api/kyc.queries';

/** The signed-in driver's profile (Figma driver "Profile"). */
export function useDriverProfile() {
  return useQuery({
    queryKey: profileKeys.card(),
    queryFn: () => profileDataSource.getProfile(),
  });
}

/** The raw `driver/me` contract, for Personal Information. */
export function useDriverMe() {
  return useQuery({
    queryKey: profileKeys.me(),
    queryFn: () => profileDataSource.getMe(),
  });
}

/** The driver's truck and its papers, for Insurance. */
export function useDriverTruck() {
  return useQuery({
    queryKey: profileKeys.truck(),
    queryFn: () => profileDataSource.getTruck(),
  });
}

/** Save the driver's own details. */
export function useUpdateDriverMe() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (patch: DriverProfileUpdate) => profileDataSource.updateMe(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.me() });
      queryClient.invalidateQueries({ queryKey: profileKeys.card() });
    },
  });
}

/**
 * Pick a photo, upload it to the presigned slot, then confirm it.
 *
 * The PUT goes straight to `uploadUrl` via plain `fetch`, bypassing
 * `apiFetch` entirely — the presigned URL's `sig`/`exp` query pair IS the
 * auth, exactly as `driver-kyc.e2e.spec.ts`'s own `uploadTo` helper does it
 * server-side; adding a bearer header would be redundant and isn't covered
 * by the signature anyway.
 */
export function useUploadDriverPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async () => {
      const { blob } = await pickAndCompress();
      if (blob.size > MAX_UPLOAD_BYTES) {
        throw new Error('This photo is too large even after compression — try a lower-resolution shot.');
      }

      const { uploadUrl, key } = await profileDataSource.presignPhoto();

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
      });
      if (!putRes.ok) throw new Error('Upload failed — check your connection and try again.');

      await profileDataSource.confirmPhoto(key);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.me() });
      queryClient.invalidateQueries({ queryKey: profileKeys.card() });
    },
  });
}

export { DocPickCancelled };
