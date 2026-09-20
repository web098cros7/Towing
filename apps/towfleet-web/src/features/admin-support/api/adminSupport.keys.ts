import type { AdminSupportTicketsQuery } from '@towing/api-contracts';

export const adminSupportKeys = {
  all: ['admin-support'] as const,
  list: (query: Partial<AdminSupportTicketsQuery>) =>
    [...adminSupportKeys.all, 'list', query] as const,
  detail: (ticketId: string) => [...adminSupportKeys.all, 'detail', ticketId] as const,
};
