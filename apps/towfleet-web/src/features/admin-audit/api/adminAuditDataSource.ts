import type {
  AdminAuditDetail,
  AdminAuditListResponse,
  AdminAuditQuery,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { resolveMock } from '@/lib/mockUtils';
import { adminAuditMock, toAdminAuditEntry } from '../mocks/adminAudit.mock';

export interface AdminAuditDataSource {
  list(query: AdminAuditQuery): Promise<AdminAuditListResponse>;
  detail(id: string): Promise<AdminAuditDetail>;
}

const DEFAULT_LIMIT = 50;

/**
 * MOCK CURSOR: `mock:<next index>`, base64-ish only in spirit — the mock is the
 * only producer AND consumer of it, and copying the server's opaque format here
 * would suggest the two are interchangeable. They are not: the server's cursor
 * is a keyset `(created_at, id)` and this one is an offset into an array.
 */
const mockCursor = (index: number): string => `mock:${index}`;

function mockCursorIndex(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number(cursor.replace(/^mock:/, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const mockSource: AdminAuditDataSource = {
  list: async (query) => {
    const all = await resolveMock(env.mockAdminAuditState, adminAuditMock, []);

    const filtered = all.filter((entry) => {
      if (query.adminId && entry.adminId !== query.adminId) return false;
      // Prefix, matching the server's `LIKE 'x%'` semantics.
      if (query.action && !entry.action.startsWith(query.action)) return false;
      if (query.subjectType && entry.subjectType !== query.subjectType) return false;
      if (query.subjectId && entry.subjectId !== query.subjectId) return false;
      if (query.from && Date.parse(entry.createdAt) < Date.parse(query.from)) return false;
      if (query.to && Date.parse(entry.createdAt) > Date.parse(query.to)) return false;
      return true;
    });

    const limit = query.limit ?? DEFAULT_LIMIT;
    const start = mockCursorIndex(query.cursor);
    const page = filtered.slice(start, start + limit);
    const nextIndex = start + page.length;

    return {
      entries: page.map(toAdminAuditEntry),
      nextCursor: nextIndex < filtered.length ? mockCursor(nextIndex) : null,
    };
  },

  detail: async (id) => {
    const all = await resolveMock(env.mockAdminAuditState, adminAuditMock, []);
    const found = all.find((entry) => entry.id === id) ?? all[0]!;
    return found;
  },
};

const restSource: AdminAuditDataSource = {
  list: (query) => {
    const params = new URLSearchParams();
    if (query.adminId) params.set('adminId', query.adminId);
    if (query.action) params.set('action', query.action);
    if (query.subjectType) params.set('subjectType', query.subjectType);
    if (query.subjectId) params.set('subjectId', query.subjectId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    return adminApiFetch<AdminAuditListResponse>(`audit?${params.toString()}`);
  },
  detail: (id) => adminApiFetch<AdminAuditDetail>(`audit/${id}`),
};

export const adminAuditDataSource: AdminAuditDataSource = env.useMocks ? mockSource : restSource;
