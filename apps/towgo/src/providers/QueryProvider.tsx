import React from 'react';
import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient } from './queryClient';
import { queryPersister } from '@/lib/storage/queryPersister';

/**
 * Chat is never written to disk. The mock conversation lives in memory and resets
 * on restart, so a persisted copy painted messages from the last session and then
 * wiped them when the refetch landed (Figma 22 draws no earlier-session state).
 */
const shouldDehydrateQuery = (query: Query) =>
  defaultShouldDehydrateQuery(query) && query.queryKey[0] !== 'chat';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
