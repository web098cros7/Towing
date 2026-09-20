'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminContentPagesQuery, AdminContentUpsertBody } from '@towing/api-contracts';
import { adminContentKeys } from './adminContent.keys';
import { adminContentDataSource } from './adminContentDataSource';

export function useAdminContentPages(query: AdminContentPagesQuery) {
  return useQuery({
    queryKey: adminContentKeys.list(query),
    queryFn: () => adminContentDataSource.list(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useUpsertContentPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: AdminContentUpsertBody }) =>
      adminContentDataSource.upsert(slug, body),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminContentKeys.all });
    },
  });
}
