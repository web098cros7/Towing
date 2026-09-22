import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { env } from '@/lib/env';
import { profileDataSource } from './profileDataSource';
import { profileKeys } from './profile.keys';

/** Profile screen + Personal Information (spec §9.1.3). */
export function useProfile() {
  return useQuery({
    queryKey: profileKeys.detail(),
    queryFn: () => profileDataSource.getProfile(),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof profileDataSource.updateProfile>[0]) =>
      profileDataSource.updateProfile(patch),
    onSuccess: (profile) => {
      queryClient.setQueryData(profileKeys.detail(), profile);
    },
  });
}

/**
 * Profile-photo upload, all three steps. The middle step is a raw `fetch` PUT
 * of the image bytes straight to the presigned URL — deliberately not
 * `apiFetch`, which would attach this app's own bearer token to a request the
 * presigned URL already authorizes on its own (same shape the vehicle RC
 * upload uses). In mock mode there is no real `uploadUrl` to PUT to, so that
 * step is skipped and only the presign/confirm round-trip runs.
 */
export function useUploadProfilePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (localUri: string) => {
      const presigned = await profileDataSource.presignPhoto();

      if (!env.useMocks) {
        const fileRes = await fetch(localUri);
        const bytes = await fileRes.blob();
        const putRes = await fetch(presigned.uploadUrl, {
          method: 'PUT',
          body: bytes,
          headers: { 'Content-Type': 'image/jpeg' },
        });
        if (!putRes.ok) throw new Error('Photo upload failed');
      }

      return profileDataSource.confirmPhoto(presigned.key, localUri);
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(profileKeys.detail(), profile);
    },
  });
}
