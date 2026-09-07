import { io, type Socket } from 'socket.io-client';
import type {
  CustomerBookingStatusEvent,
  CustomerLocationUpdateEvent,
  EtaUpdateEvent,
  SearchProgressEvent,
  WsTicketResponse,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import { env } from '@/lib/env';

/**
 * The `/customer` socket (§16.6) — Phase 17, extended in Phase 18.
 *
 * WHAT IT BUYS OVER THE POLL. `useBooking` and `useTracking` already refetch
 * every ten seconds (§19.2's fallback) and carry the same facts, so this is not
 * the difference between knowing and not knowing — it is the difference between
 * a marker that moves every three seconds and one that jumps every ten. §11.10's
 * acceptance criterion is a p95 ping→render of two seconds, which a ten-second
 * poll cannot meet by construction.
 *
 * IT DEGRADES TO NOTHING GRACEFULLY. A failed ticket, a refused handshake,
 * `REALTIME_ENABLED=false` or §19.8's force-polling switch all leave the poll
 * doing its job — which is why none of the failures below surface as errors.
 * What DOES surface is the connection state, so §11.6's honesty states can say
 * "reconnecting…" instead of pretending.
 *
 * ⚠ NEVER RUN ON A DEVICE. No dev-client build exists for this app.
 */

let socket: Socket | null = null;
let currentBookingId: string | null = null;
/** Cancels an in-flight reconnect when the screen tears down mid-backoff. */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let handlers: BookingSocketHandlers | null = null;
let listeners = new Set<(state: BookingSocketState) => void>();

/** What the §11.6 chip renders. */
export type BookingSocketState = 'connecting' | 'live' | 'reconnecting' | 'polling';

let state: BookingSocketState = 'polling';

export interface BookingSocketHandlers {
  onSearchProgress: (progress: SearchProgressEvent) => void;
  onBookingStatus: (status: CustomerBookingStatusEvent) => void;
  /** §11.4's moving truck (Phase 18). */
  onLocationUpdate: (position: CustomerLocationUpdateEvent) => void;
  /** §11.5's smoothed estimate (Phase 18). */
  onEtaUpdate: (eta: EtaUpdateEvent) => void;
  /**
   * §18's "never trust socket completeness" — called on EVERY (re)connect, not
   * only on a reconnect.
   *
   * A first connect needs it as much as a reconnect does: the socket carries
   * only changes from the moment it attaches, and the screen may have been
   * mounted for several seconds before the ticket round trip completed. Without
   * this the customer sees whatever the initial fetch had until the driver's
   * next ping — which, for a stationary driver, is not a bounded wait.
   */
  onResync: () => void;
}

/** Max backoff. Beyond this the poll is carrying the screen anyway. */
const MAX_BACKOFF_MS = 30_000;

/**
 * Connects for ONE booking.
 *
 * The booking id is baked into the ticket server-side, so a socket cannot be
 * redirected at another booking after the fact — which is also why switching
 * bookings means tearing this down and minting a new ticket rather than
 * "joining" a different room.
 */
export async function connectBookingSocket(
  bookingId: string,
  next: BookingSocketHandlers,
): Promise<void> {
  // Handlers are replaced on every call even when the socket is already up, so a
  // remounted screen's callbacks are the live ones. Without this a screen that
  // re-rendered would keep feeding the previous closure's query client.
  handlers = next;
  if (currentBookingId === bookingId && socket) return;

  disconnectBookingSocket();
  currentBookingId = bookingId;
  attempt = 0;
  await open(bookingId);
}

async function open(bookingId: string): Promise<void> {
  if (currentBookingId !== bookingId) return;
  setState('connecting');

  let ticket: WsTicketResponse;
  try {
    ticket = await apiFetch<WsTicketResponse>(`bookings/${bookingId}/realtime/ticket`, {
      method: 'POST',
    });
  } catch {
    // §19.2 / §19.8: realtime is off, or an operator forced polling. The poll is
    // unaffected and already carries the same facts.
    //
    // STILL SCHEDULES A RETRY, unlike Phase 17's version which gave up silently.
    // A ticket route that 503s because an operator paused realtime will start
    // answering again, and a customer whose app was open across that boundary
    // should get their live map back without leaving the screen.
    setState('polling');
    scheduleReconnect(bookingId);
    return;
  }

  const next = io(`${ticket.wsUrl}${ticket.namespace}`, {
    transports: ['websocket'],
    auth: { ticket: ticket.ticket },
    /**
     * RECONNECTION OFF, because the ticket is SINGLE-USE. socket.io's built-in
     * retry replays the same handshake auth, so every automatic reconnect would
     * present an already-redeemed ticket and be refused — a loop that burns
     * battery and can never succeed.
     *
     * Phase 17 said "the screen re-invokes this on focus instead". Nothing did.
     * `scheduleReconnect` below is the loop that was missing: it mints a FRESH
     * ticket per attempt, which is the only kind of retry that can work here.
     */
    reconnection: false,
    timeout: 8_000,
  });

  next.on('connect', () => {
    attempt = 0;
    setState('live');
    // Every connect, first thing. See `onResync`.
    handlers?.onResync();
  });

  next.on('search:progress', (payload: SearchProgressEvent) =>
    handlers?.onSearchProgress(payload),
  );
  next.on('booking:status', (payload: CustomerBookingStatusEvent) =>
    handlers?.onBookingStatus(payload),
  );
  next.on('location:update', (payload: CustomerLocationUpdateEvent) =>
    handlers?.onLocationUpdate(payload),
  );
  next.on('eta:update', (payload: EtaUpdateEvent) => handlers?.onEtaUpdate(payload));

  next.on('connect_error', () => {
    // A middleware rejection (expired or replayed ticket) lands here and leaves
    // `socket.active === false`, so nothing retries on its own.
    socket = null;
    setState('reconnecting');
    if (currentBookingId) scheduleReconnect(currentBookingId);
  });

  next.on('disconnect', () => {
    socket = null;
    setState('reconnecting');
    if (currentBookingId) scheduleReconnect(currentBookingId);
  });

  socket = next;
}

/**
 * Exponential backoff with FULL JITTER.
 *
 * The jitter is not decoration. Every customer with a live trip loses their
 * socket at the same instant when a gateway task recycles, and a fixed ladder
 * would have all of them mint a ticket at exactly 1 s, then 2 s, then 4 s —
 * a reconnect storm aimed at a server that has just restarted. §19.7's game day
 * kills a task on purpose and expects the fleet to come back without a
 * thundering herd.
 */
function scheduleReconnect(bookingId: string): void {
  if (reconnectTimer) return;

  const ceiling = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt);
  attempt += 1;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void open(bookingId);
  }, Math.random() * ceiling);
}

export function disconnectBookingSocket(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  currentBookingId = null;
  handlers = null;
  attempt = 0;
  setState('polling');
}

export function isBookingSocketConnected(): boolean {
  return socket?.connected === true;
}

/**
 * Subscribe to the connection state, for §11.6's chip.
 *
 * A plain observer rather than React state, because the socket is a module
 * singleton and outlives any one screen — the same shape the fleet console's
 * `realtimeConnection` uses.
 */
export function onBookingSocketState(
  listener: (next: BookingSocketState) => void,
): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function setState(next: BookingSocketState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener(next);
}

/** Whether the app should even try. Mock mode has no server to connect to. */
export const bookingSocketEnabled = !env.useMocks;
