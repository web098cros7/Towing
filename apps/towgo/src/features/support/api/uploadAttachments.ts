import { env } from '@/lib/env';
import { supportDataSource } from './supportDataSource';

/**
 * Uploads local photo URIs to the support attachment rail and returns the
 * resulting object keys in the same order. The middle step is a raw `fetch`
 * PUT of the image bytes straight to the presigned URL — deliberately not
 * `apiFetch`, which would attach this app's own bearer token to a request the
 * presigned URL already authorizes on its own (same shape as
 * `useUploadVehicleRc` in `vehicles.queries.ts`). In mock mode there is no
 * real `uploadUrl` to PUT to, so that step is skipped and only the presign
 * round-trip runs.
 */
export async function uploadSupportPhotos(localUris: string[]): Promise<string[]> {
  const keys: string[] = [];
  for (const uri of localUris) {
    const presigned = await supportDataSource.presignAttachment();

    if (!env.useMocks) {
      const fileRes = await fetch(uri);
      const bytes = await fileRes.blob();
      const putRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      if (!putRes.ok) throw new Error('Attachment upload failed');
    }

    keys.push(presigned.key);
  }
  return keys;
}
