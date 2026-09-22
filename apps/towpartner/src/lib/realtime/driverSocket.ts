import { io, type Socket } from 'socket.io-client';
import type {
  BookingMessage,
  DriverConfigUpdateEvent,
  JobOfferEvent,
  JobRevokedEvent,
  WsTicketResponse,
} from '@towing/api-contracts';
import { DRIVER_EVENT } from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import { env } from '@/lib/env';

/**
 * The `/driver` socket (§16.6).
 *
 * IT IS THE FAST PATH, NEVER THE ONLY PATH. REST ingress carries the shift
 * whenever the app is backgrounded, because a background task cannot assume a
 * live socket in Doze — and that is most of a driver's day. What the socket buys
 * is the two things REST cannot do: a server→driver channel for `config:update`
 * (so ping cadence and battery behaviour change without an app release), and the
 * room Phase 17 delivers job offers to.
 *
 * Everything here degrades to nothing gracefully. A failed ticket, a refused
 * handshake or `REALTIME_ENABLED=false` server-side leaves the driver fully
 * functional on REST — which is why none of the failures below are surfaced to
 * the UI.
 *
 * ⚠ NEVER RUN ON A DEVICE.
 */

/**
 * The frames a driver socket carries.
 *
 * Held as one object rather than three loose module variables so
 * `reconnectDriverSocket` cannot silently reattach a subset — a reconnect that
 * restored `config:update` but not `job:offer` would leave a driver online,
 * pinging, dispatchable, and unable to see a single offer.
 */
export interface DriverSocketHandlers {
  onConfigUpdate: (config: DriverConfigUpdateEvent) => void;
  onJobOffer: (offer: JobOfferEvent) => void;
  onJobRevoked: (event: JobRevokedEvent) => void;
  /**
   * Trip chat (Phase 20). Optional because the socket is also connected from
   * contexts that have no chat screen mounted — the handler is a cache merge,
   * not a UI callback, and a missing one is a no-op rather than a crash.
   */
  onChatMessage?: (message: BookingMessage) => void;
}

let socket: Socket | null = null;
let handlers: DriverSocketHandlers | null = null;

/**
 * Connects, if it can.
 *
 * The ticket route sits behind `KycApprovedGuard`, so a suspended driver is
 * refused here rather than discovering it at the gateway — and the refusal is
 * silent, because their REST calls are about to fail with a message that
 * actually explains it.
 */
export async function connectDriverSocket(next: DriverSocketHandlers): Promise<void> {
  if (!env.driverSocketEnabled || socket) return;
  handlers = next;

  let ticket: WsTicketResponse;
  try {
    ticket = await apiFetch<WsTicketResponse>('driver/realtime/ticket', { method: 'POST' });
  } catch {
    // §19.2: realtime disabled, or the driver is not currently approved. REST
    // ingress is unaffected, so there is nothing to tell them.
    return;
  }

  const connection = io(`${ticket.wsUrl}${ticket.namespace}`, {
    transports: ['websocket'],
    auth: { ticket: ticket.ticket },
    /**
     * RECONNECTION OFF, and it has to be: the ticket is SINGLE-USE. socket.io's
     * built-in retry replays the same handshake auth, so every automatic
     * reconnect would present an already-redeemed ticket and be refused — a
     * loop that burns battery and can never succeed. `reconnectDriverSocket`
     * mints a fresh ticket instead.
     *
     * Losing the socket is not losing the driver: REST ingress carries the shift
     * regardless, and §6.1's liveness is ping freshness rather than socket
     * state, so a driver stays dispatchable throughout.
     */
    reconnection: false,
    timeout: 8_000,
  });

  connection.on(DRIVER_EVENT.CONFIG_UPDATE, (config: DriverConfigUpdateEvent) =>
    handlers?.onConfigUpdate(config),
  );

  /**
   * §6.3's offer, on the fast path.
   *
   * NOT PARSED HERE, and that is considered rather than lazy: the identical
   * object arrives over REST from a route whose response the server built from
   * `jobOfferSchema`, and a client-side validation failure would leave a driver
   * staring at nothing for the twenty seconds it took the offer to expire. A
   * malformed frame renders a card with blank fields, which is visible and
   * reportable; a silently dropped one is neither.
   */
  connection.on(DRIVER_EVENT.JOB_OFFER, (offer: JobOfferEvent) => handlers?.onJobOffer(offer));

  /**
   * The offer died before its countdown did — another driver accepted, the
   * customer cancelled, or an admin paused the zone. Without this the takeover
   * screen would sit there until its own timer ran out and let the driver tap
   * Accept on a booking that has been gone for fifteen seconds.
   */
  connection.on(DRIVER_EVENT.JOB_REVOKED, (event: JobRevokedEvent) =>
    handlers?.onJobRevoked(event),
  );

  /**
   * Trip chat, both directions. The same frame carries the driver's own echo and
   * the customer's reply — the merge in `applyChatMessage` is what tells them
   * apart, and the id check there is what stops the echo duplicating the line
   * the POST already wrote in.
   */
  connection.on(DRIVER_EVENT.CHAT_MESSAGE, (message: BookingMessage) =>
    handlers?.onChatMessage?.(message),
  );

  connection.on('disconnect', () => {
    // DISCONNECT IS NOT GOING OFFLINE — the server takes the same view (§6.1
    // liveness is ping freshness, not socket state). Capture continues over REST
    // and the driver stays dispatchable while their last fix is fresh.
    socket = null;
  });

  socket = connection;
}

/** Mints a fresh ticket and reconnects — the ticket is single-use, so a retry needs a new one. */
export async function reconnectDriverSocket(): Promise<void> {
  if (!handlers) return;
  const previous = handlers;
  disconnectDriverSocket();
  await connectDriverSocket(previous);
}

export function disconnectDriverSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function isDriverSocketConnected(): boolean {
  return socket?.connected === true;
}

/**
 * Sends one fix over the socket, returning false if it could not.
 *
 * The caller falls back to the REST batch on false. Both doors feed the same
 * pipeline and share one server-side `seq`, so a handset switching between them
 * mid-shift — which happens every time the app is backgrounded — never has its
 * own pings discarded as stale by the other transport.
 */
export function emitLocation(ping: unknown): boolean {
  if (!socket?.connected) return false;
  socket.emit('location:update', ping);
  return true;
}
