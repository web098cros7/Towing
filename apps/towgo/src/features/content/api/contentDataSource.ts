import type { ContentPagesResponse, ContentPageKind } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { contentMockSource } from './contentMockSource';
import { contentRestSource } from './contentRestSource';

/**
 * W15's content rail (§9.4.12) — FAQ and Legal read at runtime.
 *
 * The screens keep their bundled copy as a FALLBACK: legal text that cannot
 * render because the network is down is worse than slightly stale text, and
 * the login footer reaches Legal before any session exists.
 */
export interface ContentDataSource {
  pages(kind: ContentPageKind): Promise<ContentPagesResponse>;
}

export const contentDataSource: ContentDataSource = env.useMocks
  ? contentMockSource
  : contentRestSource;
