import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useAuthStore } from '@/features/auth/store/authStore';
import { kycDataSource } from './kycDataSource';
import type { DriverDocType } from '../types';

export const kycKeys = {
  all: ['kyc'] as const,
  status: () => ['kyc', 'status'] as const,
};

/**
 * Wizard + status screen both read this — resume support comes from seeding
 * UI state off `documents[]` rather than any locally-tracked upload state.
 * `refetchOnWindowFocus` opts into the AppState→focusManager bridge
 * (`lib/network/onlineManager.ts`) so an approval landing while the driver's
 * app is backgrounded is picked up the moment they return — the acceptance
 * chain's "unlocks on refetch".
 *
 * Also syncs every fetch's `kycStatus` into `authStore.identity` (v5 dropped
 * `useQuery`'s `onSuccess`, hence the effect) — `RootNavigator`'s gate reads
 * the store synchronously rather than this query directly, so this is the
 * bridge that actually lets a refetch unlock the gate. `enabled` defaults to
 * true; pass `false` while unauthenticated so this doesn't fire before a
 * token exists.
 */
export function useKycStatus(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: kycKeys.status(),
    queryFn: () => kycDataSource.getStatus(),
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
  });

  useEffect(() => {
    if (query.data) {
      useAuthStore.getState().setKycStatus(query.data.kycStatus);
    }
  }, [query.data]);

  return query;
}

export function useSubmitKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => kycDataSource.submit(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: kycKeys.status() });
      useAuthStore.getState().setKycStatus(data.kycStatus);
    },
  });
}

/** Backend's raw-PUT size cap (`FilesController.MAX_UPLOAD_BYTES`) — compress comfortably under it. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Callers check `error instanceof DocPickCancelled` to no-op a cancelled picker instead of surfacing a toast. */
export class DocPickCancelled extends Error {}

export async function pickAndCompress(): Promise<{ uri: string; blob: Blob }> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library access is needed to upload this document.');
  }

  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (picked.canceled || !picked.assets[0]) throw new DocPickCancelled();

  // A phone camera photo is routinely 8-15MB; resize + JPEG-compress so a
  // typical shot lands comfortably under MAX_UPLOAD_BYTES without the driver
  // having to think about it.
  const rendered = await ImageManipulator.manipulate(picked.assets[0].uri)
    .resize({ width: 1600 })
    .renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });

  const blob = await (await fetch(saved.uri)).blob();
  return { uri: saved.uri, blob };
}

/**
 * The full per-document pipeline: pick → compress → presign → raw PUT →
 * confirm. The PUT goes straight to `uploadUrl` via plain `fetch`, bypassing
 * `apiFetch` entirely — the presigned URL's `sig`/`exp` query pair IS the
 * auth, exactly as `driver-kyc.e2e.spec.ts`'s own `uploadTo` helper does it
 * server-side; adding a bearer header would be redundant and isn't covered
 * by the signature anyway.
 */
export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (docType: DriverDocType) => {
      const { blob } = await pickAndCompress();
      if (blob.size > MAX_UPLOAD_BYTES) {
        throw new Error('This photo is too large even after compression — try a lower-resolution shot.');
      }

      const { uploadUrl, key } = await kycDataSource.presign(docType);

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
      });
      if (!putRes.ok) throw new Error('Upload failed — check your connection and try again.');

      await kycDataSource.confirm(docType, key);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: kycKeys.status() }),
  });
}
