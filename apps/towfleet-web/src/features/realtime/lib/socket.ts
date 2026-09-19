import {
  bookingStatusEventSchema,
  locationUpdateSchema,
  opsMetricsEventSchema,
  type BookingStatusEvent,
  type LocationUpdateEvent,
  type OpsMetricsEvent,
} from '@towing/api-contracts';
import { createRealtimeConnection, type ConnectionHandlers } from './realtimeConnection';
import { fetchWsTicket } from './ticket';

/**
 * The FLEET console's socket — one instance per tab, however many components
 * mount it (`RealtimeConnection.acquire` is ref-counted).
 *
 * The transport — ticket minting, the reconnect loop we own, backoff with
 * jitter, polling fallback, resync on every (re)connect — moved to
 * `lib/realtimeConnection.ts` in W1 so `/admin` could reuse it without forking.
 * What is left here is only what is fleet-specific: WHICH ticket route, and
 * WHICH events with WHICH schemas. Every payload is validated before a handler
 * sees it — JSON off the wire is `any`, and a silent shape change would corrupt
 * the query cache rather than throw.
 */
export interface RealtimeHandlers extends ConnectionHandlers {
  onLocationUpdate: (event: LocationUpdateEvent) => void;
  onBookingStatus: (event: BookingStatusEvent) => void;
  onOpsMetrics: (event: OpsMetricsEvent) => void;
}

/** Module-level singleton: one socket per tab, however many components mount. */
export const realtimeConnection = createRealtimeConnection<RealtimeHandlers>({
  fetchTicket: fetchWsTicket,
  wire(socket, handlers) {
    socket.on('location:update', (raw: unknown) => {
      const parsed = locationUpdateSchema.safeParse(raw);
      if (parsed.success) handlers.onLocationUpdate(parsed.data);
    });
    socket.on('booking:status', (raw: unknown) => {
      const parsed = bookingStatusEventSchema.safeParse(raw);
      if (parsed.success) handlers.onBookingStatus(parsed.data);
    });
    socket.on('ops:metrics', (raw: unknown) => {
      const parsed = opsMetricsEventSchema.safeParse(raw);
      if (parsed.success) handlers.onOpsMetrics(parsed.data);
    });
  },
});
