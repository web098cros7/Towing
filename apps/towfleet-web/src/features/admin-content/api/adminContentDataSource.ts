import type {
  AdminContentPage,
  AdminContentPagesQuery,
  AdminContentPagesResponse,
  AdminContentUpsertBody,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { mockContentPages, mockUpsertContent } from '../mocks/adminContent.mock';

/**
 * W15's content editor APIs — `/v1/admin/content` (§9.4.12).
 *
 * The upsert is one route for create and edit, so the mock mirrors that: saving
 * an unknown slug adds a page, saving a known one replaces it. That is what
 * makes "publish a new FAQ entry" provable in mocks mode.
 */
export interface AdminContentDataSource {
  list(query: AdminContentPagesQuery): Promise<AdminContentPagesResponse>;
  upsert(slug: string, body: AdminContentUpsertBody): Promise<AdminContentPage>;
}

const mockSource: AdminContentDataSource = {
  list: async (query) => {
    const empty = { items: [] };
    return resolveMock(env.mockAdminContentState, mockContentPages(query.kind), empty);
  },

  upsert: async (slug, body) => {
    await mockDelay(300);
    return mockUpsertContent(slug, body);
  },
};

const restSource: AdminContentDataSource = {
  list: (query) => {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    const qs = params.toString();
    return adminApiFetch<AdminContentPagesResponse>(`content${qs ? `?${qs}` : ''}`);
  },

  upsert: (slug, body) =>
    adminApiFetch<AdminContentPage>(`content/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export const adminContentDataSource: AdminContentDataSource = env.useMocks
  ? mockSource
  : restSource;
