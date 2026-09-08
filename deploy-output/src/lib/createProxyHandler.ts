import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * Factory behind both `/api/proxy` (fleet) and `/api/admin-proxy` (admin) —
 * extracted in Phase 11 when the admin console needed the exact same proxy
 * shape a second time. The realm differs only in which cookies it reads and
 * which upstream path prefix it forwards to; every security property below
 * (refresh serialization, the rightmost-`X-Forwarded-For` fix, the header
 * allowlist) has to hold for both, so a second hand-copy would only be a
 * second place for those to drift apart.
 *
 * The browser talks to `/api/{proxy,admin-proxy}/<path>`; this handler
 * forwards to `${apiBaseUrl}/v1/<upstreamPrefix>/<path>` with the access
 * token from the httpOnly cookie. Tokens never reach client JS.
 *
 * On 401 it refreshes ONCE and retries. Refreshes are serialized per refresh
 * token (module-level in-flight map): the backend rotates refresh tokens with
 * family reuse detection, so two parallel 401s that both called refresh would
 * read as token theft and revoke the whole session.
 */

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ProxyRealmConfig {
  /** e.g. `'fleet'` or `'admin'` — the segment right after `/v1/` upstream. */
  upstreamPrefix: string;
  sessionCookie: string;
  refreshCookie: string;
  setSessionCookies: (response: NextResponse, tokens: TokenPair) => void;
  clearSessionCookies: (response: NextResponse) => void;
}

/** Headers worth forwarding upstream; everything else (cookies!) stays here. */
const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];
/** Headers worth relaying back (CSV downloads need the disposition). */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'x-request-id'];

export function createProxyHandler(config: ProxyRealmConfig) {
  // Per-factory-instance, not module-level: the fleet and admin proxies must
  // not serialize each other's refreshes — they rotate different token
  // families against different upstream routes.
  const inFlightRefreshes = new Map<string, Promise<TokenPair | null>>();

  async function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
    const existing = inFlightRefreshes.get(refreshToken);
    if (existing) return existing;

    const attempt = (async () => {
      try {
        const res = await fetch(`${env.apiBaseUrl}/v1/${config.upstreamPrefix}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const body = (await res.json()) as Partial<TokenPair>;
        return body.accessToken && body.refreshToken
          ? { accessToken: body.accessToken, refreshToken: body.refreshToken }
          : null;
      } catch {
        return null;
      }
    })();

    inFlightRefreshes.set(refreshToken, attempt);
    try {
      return await attempt;
    } finally {
      inFlightRefreshes.delete(refreshToken);
    }
  }

  async function callUpstream(
    request: NextRequest,
    path: string,
    accessToken: string,
    body: ArrayBuffer | null,
  ): Promise<Response> {
    const headers = new Headers();
    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('Authorization', `Bearer ${accessToken}`);

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

    return fetch(`${env.apiBaseUrl}/v1/${config.upstreamPrefix}/${path}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: body ?? undefined,
      cache: 'no-store',
    });
  }

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

    const accessToken = request.cookies.get(config.sessionCookie)?.value;
    if (!accessToken) {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'Not signed in' } },
        { status: 401 },
      );
    }

    // Buffered (not streamed) so a post-refresh retry can replay it. Uploads are
    // capped well under Node's default body size, so buffering is cheap.
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : await request.arrayBuffer();

    let upstream = await callUpstream(request, path, accessToken, body);
    let rotated: TokenPair | null = null;

    if (upstream.status === 401) {
      const refreshToken = request.cookies.get(config.refreshCookie)?.value;
      rotated = refreshToken ? await refreshTokens(refreshToken) : null;

      if (!rotated) {
        const response = NextResponse.json(
          { error: { code: 'unauthorized', message: 'Session expired — sign in again' } },
          { status: 401 },
        );
        config.clearSessionCookies(response);
        return response;
      }

      upstream = await callUpstream(request, path, rotated.accessToken, body);
    }

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
