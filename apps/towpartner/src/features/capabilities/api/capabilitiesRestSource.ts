import { apiFetch } from '@/lib/api/client';
import type { DriverCapabilitiesResponse } from '../types';
import type { CapabilitiesDataSource } from './capabilitiesDataSource';

export const capabilitiesRestSource: CapabilitiesDataSource = {
  get() {
    return apiFetch<DriverCapabilitiesResponse>('driver/capabilities');
  },
  update(body) {
    // KycApprovedGuard re-checks the DB server-side — a 403 with
    // `{reason: 'kyc_not_approved'}` is a real, expected outcome here (an
    // admin can suspend mid-session), not a bug; the screen handles it.
    return apiFetch<DriverCapabilitiesResponse>('driver/capabilities', {
      method: 'PUT',
      body: JSON.stringify(body),
      idempotent: true,
    });
  },
};
