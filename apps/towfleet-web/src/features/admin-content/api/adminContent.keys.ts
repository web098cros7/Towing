import type { AdminContentPagesQuery } from '@towing/api-contracts';

export const adminContentKeys = {
  all: ['admin-content'] as const,
  list: (query: Partial<AdminContentPagesQuery>) =>
    [...adminContentKeys.all, 'list', query] as const,
};
