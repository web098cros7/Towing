import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuoteRequest } from '@towing/api-contracts';
import { quotesDataSource } from './quotesDataSource';
import { quotesKeys } from './quotes.keys';

export function useMyQuotes() {
  return useQuery({
    queryKey: quotesKeys.list(),
    queryFn: () => quotesDataSource.list(),
    staleTime: 30 * 1000,
  });
}

/**
 * Filing the request. Invalidates the list on success so the customer landing
 * on My Quotes sees the row they just created, not a stale cache.
 */
export function useRequestQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: QuoteRequest) => quotesDataSource.request(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: quotesKeys.all }),
  });
}

/**
 * Accepting creates the booking. The list is invalidated for the same reason,
 * and the caller navigates with the returned `booking.id`.
 */
export function useAcceptQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => quotesDataSource.accept(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: quotesKeys.all }),
  });
}
