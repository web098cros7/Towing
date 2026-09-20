import type { AdminSosQuery } from '@towing/api-contracts';

export const adminSosKeys = {
  all: ['admin-sos'] as const,
  list: (query: Partial<AdminSosQuery>) => [...adminSosKeys.all, 'list', query] as const,
  /** The banner's query — `{ open: true }`, kept under its own key so the shell can find it. */
  open: () => [...adminSosKeys.all, 'open'] as const,
  detail: (alertId: string) => [...adminSosKeys.all, 'detail', alertId] as const,
};
