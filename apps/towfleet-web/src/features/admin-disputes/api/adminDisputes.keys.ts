import type { AdminDisputesQuery } from '@towing/api-contracts';

export const adminDisputesKeys = {
  all: ['admin-disputes'] as const,
  list: (query: Partial<AdminDisputesQuery>) => [...adminDisputesKeys.all, 'list', query] as const,
  detail: (disputeId: string) => [...adminDisputesKeys.all, 'detail', disputeId] as const,
};
