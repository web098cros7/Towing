import type { AdminAuditQuery } from '@towing/api-contracts';

/**
 * W1's audit feed keys. The FILTER OBJECT is part of the list key — the feed is
 * server-filtered, so two filter states are two caches, and patching one must
 * never bleed into the other.
 */
export const adminAuditKeys = {
  all: ['admin-audit'] as const,
  list: (query: AdminAuditQuery) => [...adminAuditKeys.all, 'list', query] as const,
  detail: (id: string | null) => [...adminAuditKeys.all, 'detail', id ?? 'none'] as const,
};
