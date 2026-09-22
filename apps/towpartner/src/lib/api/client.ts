import { env } from '@/lib/env';
import { useAuthStore } from '@/features/auth/store/authStore';
import { ApiClientError, toApiClientError } from './errors';
import {
  bumpQueuedMutationAttempts,
  enqueueMutation,
  readQueuedMutations,
  removeQueuedMutation,
} from '@/lib/mutationQueue/queue';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * One in-flight refresh at a time, module-level. The web BFF's
 * `createProxyHandler.ts` keys an equivalent map by refresh token because one
 * server process serves many concurrent sessions; a mobile client has exactly
 * one session, so the map degenerates to a single slot — simpler, same
 * property: two callers racing a 401 must not both call `/auth/refresh`, or
 * the backend's family reuse-detection reads the loser as token theft and
 * revokes the whole session.
 */
let inFlightRefresh: Promise<TokenPair | null> | null = null;

async function refreshSession(): Promise<TokenPair | null> {
  if (inFlightRefresh) return inFlightRefresh;

  const attempt = (async (): Promise<TokenPair | null> => {
    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${env.apiBaseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<TokenPair>;
      if (!body.accessToken || !body.refreshToken) return null;
      return { accessToken: body.accessToken, refreshToken: body.refreshToken };
    } catch {
      return null;
    }
  })();

  inFlightRefresh = attempt;
  try {
    return await attempt;
  } finally {
    inFlightRefresh = null;
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Injects a fresh `Idempotency-Key` unless the caller already set one — replays MUST reuse the original. */
  idempotent?: boolean;
  /**
   * A genuine network failure (`fetch` itself throwing — NOT a 4xx/5xx
   * response) queues this mutation in `lib/mutationQueue/queue.ts` instead of
   * rejecting, for replay on the next `NetInfo` reconnect
   * (`lib/network/onlineManager.ts`). Implies idempotency semantics even if
   * the caller forgot `idempotent: true` — a queued mutation may replay a
   * request whose response merely failed to arrive, so the server MUST be
   * able to tell a replay from a duplicate.
   */
  enqueueOnFailure?: boolean;
}

function resolveIdempotencyKey(options?: ApiFetchOptions): string | undefined {
  if (!options?.idempotent && !options?.enqueueOnFailure) return undefined;
  const existing = new Headers(options?.headers).get('Idempotency-Key');
  if (existing) return existing;
  // Deferred import: idempotency.ts pulls in expo-crypto, which client.ts's
  // callers don't all need loaded just to make a GET request.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose; see the comment above
  const { newIdempotencyKey } = require('./idempotency') as typeof import('./idempotency');
  return newIdempotencyKey();
}

/** No Authorization header, no refresh handling — for the public OTP/social/refresh routes themselves. */
export async function publicFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type') && options?.body) headers.set('Content-Type', 'application/json');
  const idempotencyKey = resolveIdempotencyKey(options);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

  const res = await fetch(`${env.apiBaseUrl}/v1/${path}`, { ...options, headers });
  if (!res.ok) throw await toApiClientError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * The authenticated path. Injects the bearer token, and on a 401 refreshes
 * once (serialized, see `refreshSession`) and retries the original request
 * exactly once before giving up.
 */
export async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  // Computed once per call, not per underlying fetch attempt — the
  // refresh-triggered retry below and a queued replay both MUST present the
  // exact same key, never mint a fresh one.
  const idempotencyKey = resolveIdempotencyKey(options);

  const call = async (accessToken: string): Promise<Response> => {
    const headers = new Headers(options?.headers);
    if (!headers.has('Content-Type') && options?.body) headers.set('Content-Type', 'application/json');
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    return fetch(`${env.apiBaseUrl}/v1/${path}`, { ...options, headers });
  };

  const accessToken = useAuthStore.getState().accessToken;
  if (!accessToken) throw await toApiClientError(new Response(null, { status: 401 }));

  try {
    let res = await call(accessToken);

    if (res.status === 401) {
      const rotated = await refreshSession();
      if (!rotated) {
        useAuthStore.getState().clearSession();
        throw await toApiClientError(res);
      }
      useAuthStore.getState().setTokens(rotated);
      res = await call(rotated.accessToken);
    }

    if (!res.ok) throw await toApiClientError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (error) {
    // ApiClientError means a real HTTP response came back (4xx/5xx) — that is
    // a server verdict, never queue it. Only `fetch` itself throwing (DNS
    // failure, dropped connection, airplane mode at a job site) is queueable.
    if (options?.enqueueOnFailure && idempotencyKey && !(error instanceof ApiClientError)) {
      enqueueMutation({
        method: options?.method ?? 'POST',
        url: path,
        body: typeof options?.body === 'string' ? options.body : undefined,
        idempotencyKey,
      });
      return undefined as T;
    }
    throw error;
  }
}

/**
 * Replays every queued mutation, in FIFO order, each with its original
 * idempotency key (never a fresh one — see `queue.ts`'s header comment).
 * Called on `NetInfo` reconnect (`lib/network/onlineManager.ts`). A failed
 * replay is left in the queue with `attempts` bumped rather than dropped —
 * the next reconnect tries again.
 */
export async function flushMutationQueue(): Promise<void> {
  const queue = readQueuedMutations();
  for (const entry of queue) {
    try {
      await apiFetch(entry.url, {
        method: entry.method,
        body: entry.body,
        headers: {
          ...(entry.body ? { 'Content-Type': 'application/json' } : {}),
          'Idempotency-Key': entry.idempotencyKey,
        },
      });
      removeQueuedMutation(entry.id);
    } catch {
      bumpQueuedMutationAttempts(entry.id);
    }
  }
}
