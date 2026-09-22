import type { ContentPagesResponse } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { ContentDataSource } from './contentDataSource';

export const contentRestSource: ContentDataSource = {
  pages(kind) {
    return apiFetch<ContentPagesResponse>(`content/${kind}`);
  },
};
