import type { AdminQuotesQuery } from '@towing/api-contracts';

export const adminQuotesKeys = {
  all: ['admin-quotes'] as const,
  list: (query: Partial<AdminQuotesQuery>) => [...adminQuotesKeys.all, 'list', query] as const,
  detail: (id: string) => [...adminQuotesKeys.all, 'detail', id] as const,
};
