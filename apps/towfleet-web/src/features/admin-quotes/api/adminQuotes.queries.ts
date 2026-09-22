'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminQuoteDecision, AdminQuoteReject, AdminQuotesQuery } from '@towing/api-contracts';
import { adminQuotesKeys } from './adminQuotes.keys';
import { adminQuotesDataSource } from './adminQuotesDataSource';

export function useAdminQuotes(query: AdminQuotesQuery) {
  return useQuery({
    queryKey: adminQuotesKeys.list(query),
    queryFn: () => adminQuotesDataSource.list(query),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useAdminQuote(id: string | null) {
  return useQuery({
    queryKey: adminQuotesKeys.detail(id ?? ''),
    queryFn: () => adminQuotesDataSource.detail(id!),
    enabled: id !== null,
  });
}

function useQuoteMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminQuotesKeys.all }),
  });
}

export function useQuotePrice() {
  return useQuoteMutation((input: { id: string; body: AdminQuoteDecision }) =>
    adminQuotesDataSource.quote(input.id, input.body),
  );
}

export function useQuoteReject() {
  return useQuoteMutation((input: { id: string; body: AdminQuoteReject }) =>
    adminQuotesDataSource.reject(input.id, input.body),
  );
}

export function useQuoteExpire() {
  return useQuoteMutation((id: string) => adminQuotesDataSource.expire(id));
}
