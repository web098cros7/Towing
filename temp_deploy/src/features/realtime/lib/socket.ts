import {
  bookingStatusEventSchema,
  locationUpdateSchema,
  opsMetricsEventSchema,
  type BookingStatusEvent,
  type LocationUpdateEvent,
  type OpsMetricsEvent,
} from '@towing/api-contracts';
import { io, type Socket } from 'socket.io-client';
import { fetchWsTicket } from './ticket';
import type { RealtimeMode } from '../types';

/**
 * The console's single socket, with a reconnect loop we own.
 *
 * WHY WE OWN IT. socket.io-client re-invokes the async `auth` callback on every
 * connection attempt, so single-use tickets survive a network flap by
 * themselves. But a middleware rejection — which is what an expired or already
 * redeemed ticket produces — sends CONNECT_ERROR, and the client then calls
 * `destroy()`, leaves `socket.active === false`, and **never retries**. That is
 * the common production case (laptop asleep for 90s), and without this loop the
 * map would silently go dark until a page reload.
 *
 * `connectionStateRecovery` is deliberately NOT used: it replays packets missed
 * while disconnected, which for a location stream means replaying stale
 * positions. §18 says resync authoritative state over REST instead.
 */

export interface RealtimeHandlers {
  onMode: (mode: RealtimeMode) => void;
  /** Fires on every (re)connect — the §18 REST resync trigger. */
  onResync: () => void;
  onLocationUpdate: (event: LocationUpdateEvent) => void;
  onBookingStatus: (event: BookingStatusEvent) => void;
  onOpsMetrics: (event: OpsMetricsEvent) => void;
}

const MAX_BACKOFF_MS = 15_000;
/** After this many consecutive failures we stop pretending and start polling. */
const ATTEMPTS_BEFORE_POLLING = 4;
/** While polling, still probe for the socket coming back. */
const POLLING_PROBE_MS = 30_000;

class RealtimeConnection {
  private socket: Socket | null = null;
  private handlers: RealtimeHandlers | null = null;
  private refs = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private mode: RealtimeMode = 'connecting';

  /**
   * Ref-counted so React 19 StrictMode's double mount/unmount does not tear down
   * a socket the remounted provider is about to use.
   */
  acquire(handlers: RealtimeHandlers): () => void {
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

    const result = await fetchWsTicket();
    if (this.stopped) return;

    if (result.kind === 'unauthorized') {
      // Do NOT navigate. One redirect owner; see ticket.ts.
      this.setMode('offline');
      return;
    }
    if (result.kind === 'unavailable') {
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
        void fetchWsTicket().then((next) =>
          cb({ ticket: next.kind === 'ok' ? next.ticket.ticket : ticket }),
        );
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

    // Every payload is validated: JSON off the wire is `any`, and a silent shape
    // change would corrupt the query cache rather than throw.
    socket.on('location:update', (raw: unknown) => {
      const parsed = locationUpdateSchema.safeParse(raw);
      if (parsed.success) this.handlers?.onLocationUpdate(parsed.data);
    });
    socket.on('booking:status', (raw: unknown) => {
      const parsed = bookingStatusEventSchema.safeParse(raw);
      if (parsed.success) this.handlers?.onBookingStatus(parsed.data);
    });
    socket.on('ops:metrics', (raw: unknown) => {
      const parsed = opsMetricsEventSchema.safeParse(raw);
      if (parsed.success) this.handlers?.onOpsMetrics(parsed.data);
    });

    this.socket = socket;
  }

  private fail(): void {
    if (this.stopped) return;
    this.attempt += 1;

    if (this.attempt >= ATTEMPTS_BEFORE_POLLING) {
      // §19.2: WebSocket unavailable → the app polls REST every 10s. Keep
      // probing so recovery is automatic rather than requiring a reload.
      this.setMode('polling');
      this.scheduleRetry(POLLING_PROBE_MS);
      return;
    }

    this.setMode('reconnecting');
    // §18: exponential backoff with jitter. Jitter matters at fleet scale —
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

/** Module-level singleton: one socket per tab, however many components mount. */
export const realtimeConnection = new RealtimeConnection();
