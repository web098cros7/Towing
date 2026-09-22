import { type NextRequest, NextResponse } from 'next/server';
import {
  callUpstreamWithRefresh,
  type RefreshingUpstreamConfig,
} from '@/lib/refreshingUpstream';

/**
 * Factory behind both `/api/proxy` (fleet) and `/api/admin-proxy` (admin) —
 * extracted in Phase 11 when the admin console needed the exact same proxy
 * shape a second time. The realm differs only in which cookies it reads and
 * which upstream path prefix it forwards to; every security property below
 * (the header allowlist, the rightmost-`X-Forwarded-For` fix) has to hold for
 * both, so a second hand-copy would only be a second place for those to drift
 * apart.
 *
 * The browser talks to `/api/{proxy,admin-proxy}/<path>`; this handler
 * forwards to `${apiBaseUrl}/v1/<upstreamPrefix>/<path>` with the access
 * token from the httpOnly cookie. Tokens never reach client JS.
 *
 * Refresh-once-and-retry lives in `@/lib/refreshingUpstream` (M0-F1) — the
 * single implementation shared with `GET /api/admin-session`, so an expired
 * access token is silently rotated rather than logging the admin out.
 */

export interface ProxyRealmConfig extends RefreshingUpstreamConfig {
  sessionCookie: string;
  refreshCookie: string;
}

/** Headers worth forwarding upstream; everything else (cookies!) stays here. */
const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];
/** Headers worth relaying back (CSV downloads need the disposition). */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'x-request-id'];

export function createProxyHandler(config: ProxyRealmConfig) {
  async function handle(
    request: NextRequest,
    context: { params: Promise<{ path: string[] }> },
  ): Promise<Response> {
    const { path: segments } = await context.params;

    // Next's catch-all matcher splits on a literal `/` only — a request for
    // `/api/proxy/..%2Fadmin%2Fwhatever` arrives as ONE array element,
    // `"../admin/whatever"` (already `%2F`-decoded, slashes and all), not two
    // clean segments. So checking each ARRAY element for an exact `..` match
    // misses it entirely — the check has to split every element on `/` too,
    // the same way the string will eventually be interpreted once it's joined
    // into a URL. Joined naively, `fetch()`'s own URL parser then collapses
    // `/v1/fleet/../admin/...` down to `/v1/admin/...` on the wire — which
    // realm auth survives (the backend derives realm from the JWT's role
    // claim, never from the URL), but is still a request-smuggling primitive
    // worth closing outright: nothing guarantees every route ever mounted
    // outside `/v1/` stays that safe.
    const hasUnsafeSegment = segments.some((segment) =>
      segment.split('/').some((part) => part === '..' || part === '.' || part === ''),
    );
    if (hasUnsafeSegment) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not found' } },
        { status: 404 },
      );
    }
    const path = segments.join('/');

    // Buffered (not streamed) so a post-refresh retry can replay it. Uploads are
    // capped well under Node's default body size, so buffering is cheap.
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : await request.arrayBuffer();

    const headers = new Headers();
    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    // RIGHTMOST entry, not the header verbatim.
    //
    // X-Forwarded-For is a request header like any other: a browser can send one,
    // and a proxy APPENDS the peer address rather than replacing the list. So the
    // header arriving here reads `<whatever the browser claimed>, <real client>`
    // and only the last entry was vouched for by our own infrastructure.
    // Forwarding the whole list would replay the browser's value to a backend
    // that now trusts proxies (TRUST_PROXY_HOPS), which is exactly how
    // `req.ip` becomes attacker-chosen once that is non-zero.
    const clientIp = request.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
    if (clientIp) headers.set('x-forwarded-for', clientIp);

    const result = await callUpstreamWithRefresh(config, {
      path,
      search: request.nextUrl.search,
      method: request.method,
      headers,
      body: body ?? undefined,
      accessToken: request.cookies.get(config.sessionCookie)?.value,
      refreshToken: request.cookies.get(config.refreshCookie)?.value,
    });

    if (result.kind === 'no-session') {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'Not signed in' } },
        { status: 401 },
      );
    }

    if (result.kind === 'expired') {
      const response = NextResponse.json(
        { error: { code: 'unauthorized', message: 'Session expired — sign in again' } },
        { status: 401 },
      );
      config.clearSessionCookies(response);
      return response;
    }

    const { upstream, rotated } = result;
    const response = new NextResponse(upstream.body, { status: upstream.status });
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) response.headers.set(name, value);
    }
    if (rotated) config.setSessionCookies(response, rotated);
    return response;
  }

  return { GET: handle, POST: handle, PUT: handle, DELETE: handle };
}
