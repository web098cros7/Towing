import { io, type Socket } from 'socket.io-client';
import type { RealtimeMode } from '../types';
import type { TicketResult } from './ticket';

/**
 * The realm-agnostic half of a console socket (W1 §3.4).
 *
 * Extracted from the fleet connection so `/fleet` and `/admin` share the parts
 * that are IDENTICAL — single-use ticket minting, our own reconnect loop,
 * backoff with jitter, polling fallback, resync-on-every-connect — while the
 * parts that differ stay per-realm: `fetchTicket` (which BFF route) and `wire`
 * (which events, which schemas).
 *
 * WHY WE OWN THE RECONNECT LOOP. socket.io-client re-invokes the async `auth`
 * callback on every connection attempt, so single-use tickets survive a network
 * flap by themselves. But a middleware rejection — an expired or already
 * redeemed ticket — produces CONNECT_ERROR, after which the client calls
 * `destroy()`, leaves `socket.active === false`, and never retries. That is the
 * common production case (laptop asleep for 90 s), and without this loop the
 * console silently goes dark until a page reload.
 *
 * `connectionStateRecovery` is deliberately NOT used: it replays packets missed
 * while disconnected, which for a location stream means replaying stale
 * positions. §18 says resync authoritative state over REST instead.
 */
export interface ConnectionHandlers {
  onMode: (mode: RealtimeMode) => void;
  /** Fires on every (re)connect — the §18 REST resync trigger. */
  onResync: () => void;
}

const MAX_BACKOFF_MS = 15_000;
/** After this many consecutive failures we stop pretending and start polling. */
const ATTEMPTS_BEFORE_POLLING = 4;
/** While polling, still probe for the socket coming back. */
const POLLING_PROBE_MS = 30_000;

export interface RealtimeConnectionConfig<H extends ConnectionHandlers> {
  /** Mints a fresh single-use handshake ticket for the next attempt. */
  fetchTicket: () => Promise<TicketResult>;
  /**
   * Registers the realm's frame listeners on a fresh socket. Each payload is
   * validated HERE (per-realm contracts) before a handler sees it: JSON off the
   * wire is `any`, and a silent shape change would corrupt a query cache
   * rather than throw.
   */
  wire: (socket: Socket, handlers: H) => void;
}

export class RealtimeConnection<H extends ConnectionHandlers> {
  private socket: Socket | null = null;
  private handlers: H | null = null;
  private refs = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private mode: RealtimeMode = 'connecting';

  constructor(private readonly config: RealtimeConnectionConfig<H>) {}

  /**
   * Ref-counted so React 19 StrictMode's double mount/unmount does not tear
   * down a socket the remounted provider is about to use.
   */
  acquire(handlers: H): () => void {
    this.handlers = handlers;
    this.refs += 1;
    if (this.refs === 1) {
      this.stopped = false;
      this.setMode('connecting');
      void this.open();
    } else {
      handlers.onMode(this.mode);
    }

    return () => {
      this.refs -= 1;
      if (this.refs === 0) this.teardown();
    };
  }

  private setMode(mode: RealtimeMode): void {
    this.mode = mode;
    this.handlers?.onMode(mode);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;

    const result = await this.config.fetchTicket();
    if (this.stopped) return;

    if (result.kind === 'unauthorized') {
      // Do NOT navigate: the app owns login redirects, and a reconnect loop
      // racing them produces N concurrent navigations.
      this.setMode('offline');
      return;
    }
    if (result.kind === 'unavailable') {
      // §19.2 kill switch: go straight to polling and probe for recovery.
      this.setMode('polling');
      this.scheduleRetry(POLLING_PROBE_MS);
      return;
    }
    if (result.kind === 'error') {
      this.fail();
      return;
    }

    const { ticket, wsUrl, namespace } = result.ticket;
    const socket = io(`${wsUrl}${namespace}`, {
      // A ticket is single-use, so it must be minted per attempt. socket.io
      // calls this before EVERY connect, including its own retries.
      auth: (cb: (data: Record<string, unknown>) => void) => {
        void this.config
          .fetchTicket()
          .then((next) => cb({ ticket: next.kind === 'ok' ? next.ticket.ticket : ticket }));
      },
      transports: ['websocket'],
      // Our loop drives retries; socket.io's would race ours and double the
      // ticket spend.
      reconnection: false,
      timeout: 10_000,
      withCredentials: true,
    });

    socket.on('connect', () => {
      this.attempt = 0;
      this.setMode('live');
      // §18: never trust socket completeness — refetch authoritative state on
      // every (re)connect, not just the first.
      this.handlers?.onResync();
    });

    socket.on('connect_error', () => {
      socket.close();
      this.socket = null;
      this.fail();
    });

    socket.on('disconnect', (reason) => {
      this.socket = null;
      if (this.stopped) return;
      if (reason === 'io client disconnect') return;
      this.setMode('reconnecting');
      this.fail();
    });

    if (this.handlers) this.config.wire(socket, this.handlers);
    this.socket = socket;
  }

  private fail(): void {
    if (this.stopped) return;
    this.attempt += 1;

    if (this.attempt >= ATTEMPTS_BEFORE_POLLING) {
      // §19.2: WebSocket unavailable → the app polls REST every 10 s. Keep
      // probing so recovery is automatic rather than requiring a reload.
      this.setMode('polling');
      this.scheduleRetry(POLLING_PROBE_MS);
      return;
    }

    this.setMode('reconnecting');
    // §18: exponential backoff with jitter. Jitter matters at platform scale —
    // without it every console reconnects in lockstep after an outage.
    const base = Math.min(1_000 * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.scheduleRetry(base * (1 + Math.random() * 0.5));
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delayMs);
  }

  private teardown(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
    this.handlers = null;
    this.attempt = 0;
  }
}

export function createRealtimeConnection<H extends ConnectionHandlers>(
  config: RealtimeConnectionConfig<H>,
): RealtimeConnection<H> {
  return new RealtimeConnection(config);
}
