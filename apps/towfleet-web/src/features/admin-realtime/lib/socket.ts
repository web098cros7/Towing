import {
  adminBookingStatusSchema,
  adminLocationUpdateSchema,
  type AdminBookingStatusEvent,
  type AdminLocationUpdateEvent,
} from '@towing/api-contracts';
import { createRealtimeConnection, type ConnectionHandlers } from '@/features/realtime/lib/realtimeConnection';
import { fetchAdminWsTicket } from './ticket';

/**
 * The `/admin` namespace connection (W1 §3.4) — the fleet client's transport
 * with the admin realm's events.
 *
 * The two frames W1 ships declare producers on the backend AND consumers here:
 * `booking:status` (platform-wide, per A18's `ops:events`) and
 * `location:update` (batched driver positions). `ops:metrics`, `ops:badges`,
 * `sos:alert`, `dispatch:wave` and `ops:banner` are deliberately absent — the
 * backend's socket type omits them until the commit that emits them, and a
 * listener here for an event nothing sends would be dead code that reads like
 * a feature.
 */
export interface AdminRealtimeHandlers extends ConnectionHandlers {
  onBookingStatus: (event: AdminBookingStatusEvent) => void;
  onLocationUpdate: (event: AdminLocationUpdateEvent) => void;
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
  },
});
