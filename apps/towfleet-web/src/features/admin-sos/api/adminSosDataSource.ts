import type {
  AdminSosActionResponse,
  AdminSosBroadcastBody,
  AdminSosBroadcastResponse,
  AdminSosContactBody,
  AdminSosContactResponse,
  AdminSosCreateBody,
  AdminSosCreateResponse,
  AdminSosDetail,
  AdminSosNoteBody,
  AdminSosQuery,
  AdminSosResolveBody,
  AdminSosResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  mockSosAcknowledge,
  mockSosBroadcast,
  mockSosContact,
  mockSosDetail,
  mockSosList,
  mockSosNote,
  mockSosResolve,
} from '../mocks/adminSos.mock';

/**
 * W14's SOS console APIs (§13).
 *
 * Mutations are LIVE in the mock (see `mocks/adminSos.mock.ts`) rather than
 * throwing `MOCKS_NEED_BACKEND` like the money screens: acknowledging and
 * resolving is how the persistent banner clears, and a spec that cannot cross
 * that flow cannot prove the console works. The mock keeps everything in
 * module state, so the console still opens no socket and sends no request.
 *
 * `POST /admin/sos` (the ops-raised path) is not exposed here yet — the
 * console's first release works the phone-call workflow through the backend
 * and the live spec, and a form that "raises" an incident in a mock would be
 * the one fiction this screen must never ship.
 */
export interface AdminSosDataSource {
  list(query: AdminSosQuery): Promise<AdminSosResponse>;
  detail(alertId: string): Promise<AdminSosDetail>;
  create(body: AdminSosCreateBody): Promise<AdminSosCreateResponse>;
  acknowledge(alertId: string): Promise<AdminSosActionResponse>;
  note(alertId: string, body: AdminSosNoteBody): Promise<AdminSosActionResponse>;
  contact(alertId: string, body: AdminSosContactBody): Promise<AdminSosContactResponse>;
  resolve(alertId: string, body: AdminSosResolveBody): Promise<AdminSosActionResponse>;
  broadcast(alertId: string, body: AdminSosBroadcastBody): Promise<AdminSosBroadcastResponse>;
}

const MOCKS_NEED_BACKEND =
  'Mocks are on — raising an SOS needs the real backend. Set NEXT_PUBLIC_USE_MOCKS=false.';

const mockSource: AdminSosDataSource = {
  list: async (query) => {
    const empty = { items: [], page: query.page, limit: query.limit, total: 0 };
    return resolveMock(env.mockAdminSosState, mockSosList(query), empty);
  },

  detail: async (alertId) => {
    await mockDelay(200);
    return resolveMock(env.mockAdminSosState, mockSosDetail(alertId), mockSosDetail(alertId));
  },

  create: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  acknowledge: async (alertId) => {
    await mockDelay(300);
    mockSosAcknowledge(alertId);
    const detail = mockSosDetail(alertId);
    return { alertId, status: detail.status, at: detail.acknowledgedAt ?? detail.updatedAt };
  },
  note: async (alertId, body) => {
    await mockDelay(300);
    mockSosNote(alertId, body.note);
    const detail = mockSosDetail(alertId);
    return { alertId, status: detail.status, at: new Date().toISOString() };
  },
  contact: async (alertId, body) => {
    await mockDelay(300);
    return mockSosContact(alertId, body.contactId);
  },
  resolve: async (alertId, body) => {
    await mockDelay(300);
    mockSosResolve(alertId, body.resolution);
    return { alertId, status: 'resolved', at: new Date().toISOString() };
  },
  broadcast: async (alertId, body) => {
    await mockDelay(300);
    const notified = mockSosBroadcast(alertId, body);
    return { alertId, notified, radiusKm: body.radiusKm ?? 3 };
  },
};

const restSource: AdminSosDataSource = {
  list: (query) => {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
    if (query.open) params.set('open', 'true');
    if (query.status) params.set('status', query.status);
    if (query.subjectType) params.set('subjectType', query.subjectType);
    return adminApiFetch<AdminSosResponse>(`sos?${params.toString()}`);
  },

  detail: (alertId) => adminApiFetch<AdminSosDetail>(`sos/${alertId}`),

  create: (body) =>
    adminApiFetch<AdminSosCreateResponse>('sos', { method: 'POST', body: JSON.stringify(body) }),

  acknowledge: (alertId) =>
    adminApiFetch<AdminSosActionResponse>(`sos/${alertId}/acknowledge`, { method: 'POST' }),

  note: (alertId, body) =>
    adminApiFetch<AdminSosActionResponse>(`sos/${alertId}/note`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  contact: (alertId, body) =>
    adminApiFetch<AdminSosContactResponse>(`sos/${alertId}/contact`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  resolve: (alertId, body) =>
    adminApiFetch<AdminSosActionResponse>(`sos/${alertId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  broadcast: (alertId, body) =>
    adminApiFetch<AdminSosBroadcastResponse>(`sos/${alertId}/broadcast`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const adminSosDataSource: AdminSosDataSource = env.useMocks ? mockSource : restSource;
