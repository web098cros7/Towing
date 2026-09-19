import type { AdminAdminsQuery } from '@towing/api-contracts';

export const adminAdminsKeys = {
  all: ['admin-admins'] as const,
  list: (query: Pick<AdminAdminsQuery, 'subRole' | 'status' | 'q' | 'page'>) =>
    [...adminAdminsKeys.all, 'list', query.subRole ?? 'any', query.status ?? 'any', query.q ?? '', query.page] as const,
  detail: (id: string) => [...adminAdminsKeys.all, 'detail', id] as const,
};
