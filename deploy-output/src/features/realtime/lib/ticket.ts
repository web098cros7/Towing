import { wsTicketResponseSchema, type WsTicketResponse } from '@towing/api-contracts';

export type TicketResult =
  | { kind: 'ok'; ticket: WsTicketResponse }
  /** Session genuinely gone. Stop reconnecting; do not navigate. */
  | { kind: 'unauthorized' }
  /** Realtime deliberately off (§19.2). Go straight to polling. */
  | { kind: 'unavailable' }
  /** Transient — the caller backs off and retries. */
  | { kind: 'error' };

/**
 * Fetches a single-use WebSocket handshake ticket.
 *
 * Deliberately raw `fetch`, NOT `apiFetch`: `apiFetch` does
 * `window.location.assign('/login')` on a 401, and in a reconnect storm that is
 * N concurrent navigations racing the socket teardown. There must be exactly one
 * owner of the login redirect, and it is the always-mounted dashboard/trucks
 * queries — not the reconnect loop.
 *
 * The BFF proxy still gives us its serialized refresh-on-401 for free on this
 * route, so a merely-expired access token never surfaces here as `unauthorized`.
 */
export async function fetchWsTicket(signal?: AbortSignal): Promise<TicketResult> {
  let res: Response;
  try {
    res = await fetch('/api/proxy/realtime/ticket', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    return { kind: 'error' };
  }

  if (res.status === 401) return { kind: 'unauthorized' };
  if (res.status === 503) return { kind: 'unavailable' };
  if (!res.ok) return { kind: 'error' };

  const parsed = wsTicketResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { kind: 'ok', ticket: parsed.data } : { kind: 'error' };
}
