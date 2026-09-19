import type {
  AdminAdminDetail,
  AdminAdminsListResponse,
  AdminAdminsQuery,
  AdminCreateAdmin,
  AdminCreateAdminResponse,
  AdminDeactivateAdmin,
  AdminResetPasswordResponse,
  AdminUpdateAdmin,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminAdminsMock } from '../mocks/adminAdmins.mock';

export interface AdminAdminsDataSource {
  list(query: AdminAdminsQuery): Promise<AdminAdminsListResponse>;
  detail(id: string): Promise<AdminAdminDetail>;
  create(body: AdminCreateAdmin): Promise<AdminCreateAdminResponse>;
  update(id: string, body: AdminUpdateAdmin): Promise<AdminAdminDetail>;
  deactivate(id: string, body: AdminDeactivateAdmin): Promise<AdminAdminDetail>;
  reactivate(id: string, body: AdminDeactivateAdmin): Promise<AdminAdminDetail>;
  resetPassword(id: string): Promise<AdminResetPasswordResponse>;
}

const mockSource: AdminAdminsDataSource = {
  list: async (query) => {
    const items = await resolveMock(env.mockAdminAdminsState, adminAdminsMock, []);
    const filtered = items.filter(
      (item) =>
        (!query.subRole || item.subRole === query.subRole) &&
        (!query.status || item.status === query.status) &&
        (!query.q ||
          item.name.toLowerCase().includes(query.q.toLowerCase()) ||
          item.email.toLowerCase().includes(query.q.toLowerCase())),
    );
    const start = (query.page - 1) * query.limit;
    return {
      items: filtered.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
    };
  },
  detail: async (id) => {
    const items = await resolveMock(env.mockAdminAdminsState, adminAdminsMock, []);
    const found = items.find((item) => item.id === id) ?? items[0]!;
    return {
      ...found,
      createdBy: null,
      deactivatedAt: found.status === 'active' ? null : new Date().toISOString(),
      deactivatedBy: null,
      twofaConfirmedAt: found.twofaEnabled ? found.createdAt : null,
    };
  },
  // Mock mutations are deliberately no-ops (house rule, see
  // `adminFinanceDataSource.ts`): creating an admin is a consequential write,
  // and proving it works belongs in `e2e-live/`, against a real database.
  create: async () => {
    await mockDelay();
    throw new Error('Mock create is a no-op — proven in e2e-live');
  },
  update: async () => {
    await mockDelay();
    throw new Error('Mock update is a no-op — proven in e2e-live');
  },
  deactivate: async () => {
    await mockDelay();
    throw new Error('Mock deactivate is a no-op — proven in e2e-live');
  },
  reactivate: async () => {
    await mockDelay();
    throw new Error('Mock reactivate is a no-op — proven in e2e-live');
  },
  resetPassword: async () => {
    await mockDelay();
    throw new Error('Mock reset is a no-op — proven in e2e-live');
  },
};

const restSource: AdminAdminsDataSource = {
  list: (query) => {
    const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
    if (query.subRole) params.set('subRole', query.subRole);
    if (query.status) params.set('status', query.status);
    if (query.q) params.set('q', query.q);
    return adminApiFetch<AdminAdminsListResponse>(`admins?${params.toString()}`);
  },
  detail: (id) => adminApiFetch<AdminAdminDetail>(`admins/${id}`),
  create: (body) =>
    adminApiFetch<AdminCreateAdminResponse>('admins', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) =>
    adminApiFetch<AdminAdminDetail>(`admins/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deactivate: (id, body) =>
    adminApiFetch<AdminAdminDetail>(`admins/${id}/deactivate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reactivate: (id, body) =>
    adminApiFetch<AdminAdminDetail>(`admins/${id}/reactivate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resetPassword: (id) =>
    adminApiFetch<AdminResetPasswordResponse>(`admins/${id}/reset-password`, { method: 'POST' }),
};

export const adminAdminsDataSource: AdminAdminsDataSource = env.useMocks ? mockSource : restSource;
