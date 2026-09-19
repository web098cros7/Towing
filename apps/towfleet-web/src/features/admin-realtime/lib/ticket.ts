import { wsTicketResponseSchema } from '@towing/api-contracts';
import type { TicketResult } from '@/features/realtime/lib/ticket';

/**
 * The admin realm's handshake ticket (W1 §3.4) — the fleet fetcher's shape,
 * pointed at the admin BFF route.
 *
 * Raw `fetch`, NOT `adminApiFetch`: `adminApiFetch` navigates to the login page
 * on a 401, and a reconnect storm would race N navigations against each other
 * and against the socket teardown. There is exactly one owner of the admin
 * login redirect (the identity provider), and it is not this loop. The BFF
 * proxy still gives us its refresh-on-401 for free, so a merely-expired access
 * token never surfaces here as `unauthorized`.
 */
export async function fetchAdminWsTicket(signal?: AbortSignal): Promise<TicketResult> {
  let res: Response;
  try {
    res = await fetch('/api/admin-proxy/realtime/ticket', {
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
