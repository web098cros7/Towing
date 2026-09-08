import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ComplianceDocType } from '../types';
import { trucksKeys } from './trucks.keys';

export interface UploadComplianceInput {
  truckId: string;
  docType: ComplianceDocType;
  issuedAt?: string;
  expiresAt?: string;
  file?: File | null;
}

/**
 * POST /fleet/trucks/:id/compliance through the BFF proxy as multipart.
 * Success invalidates the trucks list so the drawer's checklist (and any
 * recomputed truck status) refreshes.
 */
export function useUploadComplianceDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadComplianceInput) => {
      const form = new FormData();
      form.set('docType', input.docType);
      if (input.issuedAt) form.set('issuedAt', input.issuedAt);
      if (input.expiresAt) form.set('expiresAt', input.expiresAt);
      if (input.file) form.set('file', input.file);

      const res = await fetch(`/api/proxy/trucks/${input.truckId}/compliance`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Upload failed');
      }
      return (await res.json()) as { truckStatus: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trucksKeys.all });
    },
  });
}
