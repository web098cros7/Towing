import { useQuery } from '@tanstack/react-query';
import type { ContentPageKind } from '@towing/api-contracts';
import { contentDataSource } from './contentDataSource';

/**
 * FAQ and Legal, fetched at runtime with the bundled copy as the fallback —
 * the screens decide what to do when this fails, because "help is unreachable
 * offline" and "legal is unreachable offline" are different problems.
 *
 * `staleTime` is generous on purpose: content changes when an operator clicks
 * save, not per session, and the backend already caches for 5 minutes.
 */
export function useContentPages(kind: ContentPageKind) {
  return useQuery({
    queryKey: ['content', kind],
    queryFn: () => contentDataSource.pages(kind),
    staleTime: 5 * 60_000,
  });
}
