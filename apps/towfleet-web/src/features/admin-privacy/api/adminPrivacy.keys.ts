import type { AdminDeletionRequestsQuery } from '@towing/api-contracts';

export const adminPrivacyKeys = {
  all: ['admin-privacy'] as const,
  requests: (query: Partial<AdminDeletionRequestsQuery>) =>
    [...adminPrivacyKeys.all, 'requests', query] as const,
  request: (id: string) => [...adminPrivacyKeys.all, 'request', id] as const,
  retention: () => [...adminPrivacyKeys.all, 'retention'] as const,
};
