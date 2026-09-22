import { apiFetch } from '@/lib/api/client';
import { env } from '@/lib/env';

/**
 * SOS alert (Figma 26 · Emergency). The server alerts MiTow's safety desk AND
 * messages the customer's emergency contacts by SMS/WhatsApp.
 *
 * `POST sos` body `{ lat, lng, accuracyM?, bookingId? }` →
 * `SosCreateResponse { alertId, status, createdAt, replayed }`.
 * `POST sos/:alertId/cancel` → `SosCancelResponse` (allowed within
 * `SOS_UNDO_WINDOW_SECONDS` = 5, exported from '@towing/api-contracts').
 */

export type SosCreateInput = {
  lat: number;
  lng: number;
  accuracyM?: number;
  bookingId?: string;
};

export type SosCreateResponse = {
  alertId: string;
  status: string;
  createdAt: string;
  replayed: boolean;
};

export type SosCancelResponse = {
  alertId: string;
  status: string;
  cancelledAt: string;
};

export async function sendSos(input: SosCreateInput): Promise<SosCreateResponse> {
  if (env.useMocks) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      alertId: 'mock-sos',
      status: 'triggered',
      createdAt: new Date().toISOString(),
      replayed: false,
    };
  }
  return apiFetch<SosCreateResponse>('/sos', {
    method: 'POST',
    body: JSON.stringify(input),
    idempotent: true,
  });
}

export async function cancelSos(alertId: string): Promise<SosCancelResponse> {
  if (env.useMocks) {
    return {
      alertId,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    };
  }
  return apiFetch<SosCancelResponse>(`/sos/${alertId}/cancel`, {
    method: 'POST',
    idempotent: true,
  });
}
