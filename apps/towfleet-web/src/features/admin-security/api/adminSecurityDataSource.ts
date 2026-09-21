import type {
  AdminRecoveryCodesResponse,
  AdminSessionsResponse,
  AdminTotpEnrollResponse,
  AdminTotpStatus,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminSessionsMock } from '../mocks/adminSecurity.mock';

export interface AdminSecurityDataSource {
  enroll(): Promise<AdminTotpEnrollResponse>;
  confirm(code: string): Promise<AdminTotpStatus>;
  disable(reason: string): Promise<AdminTotpStatus>;
  recoveryCodes(): Promise<AdminRecoveryCodesResponse>;
  /** W1 §3.6: the caller's own live sessions, newest activity first. */
  sessions(): Promise<AdminSessionsResponse>;
  revokeSession(id: string): Promise<void>;
}

/**
 * TOTP self-service (W2) and the session list (W1). Every route acts on the
 * CALLER — there is no id to pass, so one admin can never enrol for, or revoke
 * the sessions of, another.
 *
 * Mock mutations are no-ops that throw, the house rule: enrolling a second
 * factor or killing a session is a security change and proving it works
 * belongs against the real backend (and `e2e-live/`).
 */
const mockSource: AdminSecurityDataSource = {
  sessions: async () => ({
    sessions: await resolveMock(env.mockAdminSessionsState, adminSessionsMock, []),
  }),
  enroll: async () => {
    await mockDelay();
    throw new Error('Mock enrolment is a no-op — proven in e2e-live');
  },
  confirm: async () => {
    await mockDelay();
    throw new Error('Mock confirm is a no-op — proven in e2e-live');
  },
  disable: async () => {
    await mockDelay();
    throw new Error('Mock disable is a no-op — proven in e2e-live');
  },
  recoveryCodes: async () => {
    await mockDelay();
    throw new Error('Mock recovery codes are a no-op — proven in e2e-live');
  },
  revokeSession: async () => {
    await mockDelay();
    throw new Error('Mock session revoke is a no-op — proven in e2e-live');
  },
};

const restSource: AdminSecurityDataSource = {
  enroll: () => adminApiFetch<AdminTotpEnrollResponse>('auth/2fa/enroll', { method: 'POST' }),
  confirm: (code) =>
    adminApiFetch<AdminTotpStatus>('auth/2fa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  disable: (reason) =>
    adminApiFetch<AdminTotpStatus>('auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  recoveryCodes: () =>
    adminApiFetch<AdminRecoveryCodesResponse>('auth/2fa/recovery-codes', { method: 'POST' }),
  sessions: () => adminApiFetch<AdminSessionsResponse>('auth/sessions'),
  revokeSession: (id) => adminApiFetch<void>(`auth/sessions/${id}`, { method: 'DELETE' }),
};

export const adminSecurityDataSource: AdminSecurityDataSource = env.useMocks
  ? mockSource
  : restSource;
