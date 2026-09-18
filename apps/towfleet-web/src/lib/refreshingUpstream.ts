import { type NextResponse } from 'next/server';
import { env } from '@/lib/env';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshingUpstreamConfig {
  /** e.g. `'fleet'` or `'admin'` — the segment right after `/v1/` upstream. */
  upstreamPrefix: string;
  setSessionCookies: (response: NextResponse, tokens: TokenPair) => void;
  clearSessionCookies: (response: NextResponse) => void;
}

// Module-level, keyed by the refresh token string itself. Fleet and admin
// tokens are distinct strings, so the two realms never serialize each other's
// refreshes — the same guarantee the old per-factory map gave, without a
// second copy of the logic. M0-F1: this is the ONE refresh implementation.
// The backend rotates refresh tokens with family reuse detection, so two
// parallel 401s that both called refresh would read as token theft and revoke
// the whole session — no caller may implement its own refresh.
const inFlightRefreshes = new Map<string, Promise<TokenPair | null>>();

async function refreshTokens(
  upstreamPrefix: string,
  refreshToken: string,
): Promise<TokenPair | null> {
  const existing = inFlightRefreshes.get(refreshToken);
  if (existing) return existing;

  const attempt = (async () => {
    try {
      const res = await fetch(`${env.apiBaseUrl}/v1/${upstreamPrefix}/auth/refresh`, {
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

export type UpstreamCallResult =
  | { kind: 'responded'; upstream: Response; rotated: TokenPair | null }
  | { kind: 'no-session' }
  | { kind: 'expired' };

/**
 * Call upstream, refreshing once on 401 and retrying (M0-F1).
 *
 * - No access token → `no-session` (the caller answers 401 WITHOUT clearing
 *   cookies: nothing expired, there was simply no session).
 * - Upstream 401 + refresh failure → `expired` (the caller answers 401 AND
 *   clears both cookies — only here is the session actually dead).
 * - Otherwise → `responded`, with `rotated` set when a refresh happened, so
 *   the caller can persist the rotated pair on its response.
 *
 * Network failures throw, exactly as a bare `fetch` would — callers keep
 * their own behaviour (the proxies surface a 500, the session route a 502).
 */
export async function callUpstreamWithRefresh(
  config: RefreshingUpstreamConfig,
  call: {
    path: string;
    search?: string;
    method: string;
    /** Fully-built headers INCLUDING `Authorization: Bearer <access>` — the shared path only swaps the token on retry. */
    headers: Headers;
    body?: ArrayBuffer | undefined;
    accessToken: string | undefined;
    refreshToken: string | undefined;
  },
): Promise<UpstreamCallResult> {
  if (!call.accessToken) return { kind: 'no-session' };

  const url = `${env.apiBaseUrl}/v1/${config.upstreamPrefix}/${call.path}${call.search ?? ''}`;
  const send = (accessToken: string): Promise<Response> => {
    const headers = new Headers(call.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(url, {
      method: call.method,
      headers,
      body: call.body ?? undefined,
      cache: 'no-store',
    });
  };

  let upstream = await send(call.accessToken);
  let rotated: TokenPair | null = null;

  if (upstream.status === 401) {
    rotated = call.refreshToken
      ? await refreshTokens(config.upstreamPrefix, call.refreshToken)
      : null;
    if (!rotated) return { kind: 'expired' };
    upstream = await send(rotated.accessToken);
  }

  return { kind: 'responded', upstream, rotated };
}
