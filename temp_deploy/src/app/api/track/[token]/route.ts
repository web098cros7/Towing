import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * §11.7's public read, proxied — `/api/track/{token}` → `GET /v1/track/{token}`.
 *
 * WHY IT DOES NOT USE THE BFF PROXY. `createProxyHandler` exists to attach a
 * bearer from an httpOnly session cookie and to serialize refresh; both are
 * meaningless here, and pointing this at it would 401 every viewer. The backend
 * route is `@Public()` precisely so no session is needed.
 *
 * WHY IT IS PROXIED AT ALL, rather than the browser calling the backend. Two
 * reasons, and the second is the operational one:
 *
 *  1. The backend origin is server-side config (`API_BASE_URL`). Exposing it as
 *     a `NEXT_PUBLIC_*` value would bake it into the bundle and make moving the
 *     API a web rebuild — the same argument `wsUrl` won on the realtime ticket.
 *  2. It keeps the page same-origin, so there is no CORS preflight on a route
 *     that is polled every ten seconds by however many people were forwarded
 *     the link.
 *
 * IT FORWARDS THE UPSTREAM STATUS VERBATIM, including 404 (unknown token) and
 * 410 (`share_link_expired`). The page renders a different, calmer thing for
 * each, and collapsing them here would take that away.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  // Bounded and character-constrained before it reaches the wire. The backend
  // validates again — this is not the boundary that matters — but an
  // unauthenticated route should not forward an arbitrary path segment.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'Invalid link' } },
      { status: 422 },
    );
  }

  try {
    const upstream = await fetch(`${env.apiBaseUrl}/v1/track/${token}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    const body: unknown = await upstream.json().catch(() => null);
    return NextResponse.json(body ?? {}, { status: upstream.status });
  } catch {
    // The API is unreachable. 502 rather than 500: the page says "we cannot
    // reach the trip right now" and keeps polling, which is the truth.
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Cannot reach the trip service' } },
      { status: 502 },
    );
  }
}
