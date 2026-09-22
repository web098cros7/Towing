import { env } from '@/lib/env';
import { apiFetch } from '@/lib/api/client';

/**
 * SOS (Phase 19).
 *
 * THE SERVER ACCEPTS SOS FROM BOTH REALMS — customer and driver — on the same
 * `POST /v1/sos`. That is deliberate: a driver stranded on a hard shoulder at
 * 2 a.m. is the same emergency as a customer stranded on the same shoulder, and
 * giving the driver a different endpoint would mean two alerting paths, two
 * on-call runbooks, and one of them would rot.
 *
 * WHAT HAPPENS SERVER-SIDE: the alert lands on MiTow's safety desk — the ops
 * console and the on-call rotation — with the booking attached, so whoever
 * picks it up already knows which job, which driver, which customer, and where.
 * The driver does not need to explain anything on the phone; the context is
 * already in front of the person answering.
 *
 * THE UNDO WINDOW IS FIVE SECONDS (`SOS_UNDO_WINDOW_SECONDS`). It exists for
 * the fat-finger case — a driver reaching for Navigate and hitting SOS — and
 * for nothing else. Five seconds is long enough to notice the mistake and short
 * enough that a real emergency is not delayed by a "did you mean it?" prompt.
 */

export interface SendSosInput {
  lat: number;
  lng: number;
  accuracyM?: number;
  bookingId?: string;
}

export interface SosAlert {
  alertId: string;
  status: string;
  createdAt: string;
  replayed: boolean;
}

export interface SosCancelResult {
  alertId: string;
  status: string;
  cancelledAt: string;
}

/**
 * Raise an SOS. `idempotent: true` so a retry on a flaky connection does not
 * raise a second alert — the safety desk seeing the same emergency twice is
 * noise on the one channel that must stay quiet.
 */
export async function sendSos(input: SendSosInput): Promise<SosAlert> {
  if (env.useMocks) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      alertId: `mock-sos-${Date.now()}`,
      status: 'active',
      createdAt: new Date().toISOString(),
      replayed: false,
    };
  }

  return apiFetch<SosAlert>('sos', {
    method: 'POST',
    body: JSON.stringify(input),
    idempotent: true,
  });
}

/**
 * Cancel an SOS inside the undo window. The server enforces
 * `SOS_UNDO_WINDOW_SECONDS`; a call after the window returns an error and the
 * alert stands. The client's countdown is a courtesy, not the gate.
 */
export async function cancelSos(alertId: string): Promise<SosCancelResult> {
  if (env.useMocks) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      alertId,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    };
  }

  return apiFetch<SosCancelResult>(`sos/${alertId}/cancel`, {
    method: 'POST',
    idempotent: true,
  });
}
