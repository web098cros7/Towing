import type { Metadata } from 'next';
import { PublicTrackView } from '@/features/track/PublicTrackView';

/**
 * §11.7's public share-trip page — `https://towing.app/t/{token}`.
 *
 * THE ONLY UNAUTHENTICATED PAGE IN THIS APP, and it lives here rather than in a
 * fifth Next app for the reason the admin console already settled: a second app
 * duplicates the shell, the build and the deploy for one route. It sits OUTSIDE
 * every route group deliberately — `(console)`, `(auth)`, `(onboarding)` and
 * `(print)` all inherit chrome or a session, and this needs neither.
 *
 * `middleware.ts` IS DENY-BY-DEFAULT and would redirect this to `/login`. The
 * explicit `PUBLIC_PREFIXES` branch there is what makes the page reachable, and
 * `e2e/track.spec.ts` asserts it from a browser with no cookies — because the
 * failure mode is invisible to anyone testing while already logged in.
 */

export const metadata: Metadata = {
  title: 'Live trip',
  /**
   * NOINDEX, and this is not optional.
   *
   * A share link is forwarded through WhatsApp and pasted into group chats. Left
   * indexable, a crawler that follows one would put a person's live position and
   * a vehicle plate into a search engine — permanently, and long after the trip
   * and the token have expired. Robots directives are not a security control,
   * which is why the token and the ~100 m coarsening carry the actual weight;
   * this closes the accidental path.
   */
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Rendered dynamically, never cached.
 *
 * The whole page is a position that changes every few seconds; a statically
 * generated or ISR-cached version would show a truck where it was when the cache
 * was filled — which is the one failure a live-tracking page cannot have. The
 * client component polls; this shell just has to not get in the way.
 */
export const dynamic = 'force-dynamic';

export default async function PublicTrackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicTrackView token={token} />;
}
