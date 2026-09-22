import {
  adminBookingStatusSchema,
  adminLocationUpdateSchema,
  adminOpsBadgesEventSchema,
  adminOpsMetricsEventSchema,
  adminSosAlertEventSchema,
  type AdminBookingStatusEvent,
  type AdminLocationUpdateEvent,
  type AdminOpsBadgesEvent,
  type AdminOpsMetricsEvent,
  type AdminSosAlertEvent,
  type OpsSubscribe,
} from '@towing/api-contracts';
import {
  createRealtimeConnection,
  type ConnectionHandlers,
} from '@/features/realtime/lib/realtimeConnection';
import { fetchAdminWsTicket } from './ticket';

/**
 * The `/admin` namespace connection (W1 §3.4) — the fleet client's transport
 * with the admin realm's events.
 *
 * W1 shipped `booking:status` and `location:update`; W3 added the two frames
 * its broadcaster now produces, and W14 adds `sos:alert` in the same commit as
 * its producer (`SosService` publishes, the bridge relays). `dispatch:wave`
 * and `ops:banner` remain absent until their workstreams emit them; a listener
 * for an event nothing sends would be dead code that reads like a feature.
 */
export interface AdminRealtimeHandlers extends ConnectionHandlers {
  onBookingStatus: (event: AdminBookingStatusEvent) => void;
  onLocationUpdate: (event: AdminLocationUpdateEvent) => void;
  onOpsMetrics: (event: AdminOpsMetricsEvent) => void;
  onOpsBadges: (event: AdminOpsBadgesEvent) => void;
  onSosAlert: (event: AdminSosAlertEvent) => void;
}

/** One admin socket per tab; the ref-counting lives in the shared connection. */
export const adminRealtimeConnection = createRealtimeConnection<AdminRealtimeHandlers>({
  fetchTicket: fetchAdminWsTicket,
  wire(socket, handlers) {
    socket.on('booking:status', (raw: unknown) => {
      const parsed = adminBookingStatusSchema.safeParse(raw);
      if (parsed.success) handlers.onBookingStatus(parsed.data);
    });
    socket.on('location:update', (raw: unknown) => {
      const parsed = adminLocationUpdateSchema.safeParse(raw);
      if (parsed.success) handlers.onLocationUpdate(parsed.data);
    });
    socket.on('ops:metrics', (raw: unknown) => {
      const parsed = adminOpsMetricsEventSchema.safeParse(raw);
      if (parsed.success) handlers.onOpsMetrics(parsed.data);
    });
    socket.on('ops:badges', (raw: unknown) => {
      const parsed = adminOpsBadgesEventSchema.safeParse(raw);
      if (parsed.success) handlers.onOpsBadges(parsed.data);
    });
    socket.on('sos:alert', (raw: unknown) => {
      const parsed = adminSosAlertEventSchema.safeParse(raw);
      if (parsed.success) handlers.onSosAlert(parsed.data);
    });
  },
});

/**
 * Outbound `ops:subscribe` (W4) — the zone filter is a room join so the server
 * stops pushing every zone's positions to a filtered operator. Fire-and-forget
 * by design: the caller re-sends its current filter on every (re)connect, so a
 * send that happens while the socket is down is replaced, never queued.
 */
export function adminOpsSubscribe(filters: OpsSubscribe): boolean {
  return adminRealtimeConnection.send('ops:subscribe', filters);
}
