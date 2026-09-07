import type {
  BookingStatusEvent,
  CustomerBookingStatusEvent,
  CustomerLocationUpdateEvent,
  CustomerReadyEvent,
  DriverConfigUpdateEvent,
  DriverLocationAccepted,
  DriverLocationPing,
  DriverReadyEvent,
  EtaUpdateEvent,
  FleetId,
  JobOfferEvent,
  JobRevokedEvent,
  LocationUpdateEvent,
  OpsMetricsEvent,
  RealtimeReadyEvent,
  SearchProgressEvent,
} from '@towing/api-contracts';
import type { Namespace, Server, Socket } from 'socket.io';

/**
 * Typed Socket.io surface for the `/fleet` namespace.
 *
 * `ClientToServerEvents` is deliberately EMPTY. Phase 5 ships zero
 * `@SubscribeMessage` handlers: room membership is derived solely from the
 * verified handshake claim, so nothing client-supplied can ever reach a room
 * name. That is the WebSocket analogue of `FleetScopeGuard`, and keeping the
 * type empty is what makes adding an inbound handler a deliberate decision
 * rather than an accident.
 */
export interface ClientToServerEvents {
  // intentionally empty — see above
}

export interface ServerToClientEvents {
  'realtime:ready': (payload: RealtimeReadyEvent) => void;
  'location:update': (payload: LocationUpdateEvent) => void;
  'booking:status': (payload: BookingStatusEvent) => void;
  'ops:metrics': (payload: OpsMetricsEvent) => void;
}

/** Attached at handshake; the only source of truth for a socket's tenant. */
export interface FleetSocketData {
  fleetId: FleetId;
  userId: string;
}

export type FleetSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  FleetSocketData
>;

export type FleetNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  FleetSocketData
>;

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  FleetSocketData
>;

// ---------------------------------------------------------------------------
// The `/driver` namespace (Phase 16)
// ---------------------------------------------------------------------------

/**
 * THE FIRST INBOUND SOCKET MESSAGE IN THIS CODEBASE.
 *
 * `/fleet`'s equivalent above is empty and must stay empty: its guarantee is
 * that nothing client-supplied can reach a room name. This namespace cannot
 * offer that guarantee — it exists to receive a stream — so it is a SEPARATE
 * type on a SEPARATE namespace rather than a widening of the fleet one. The
 * property that replaces it here: the handler reads its subject from
 * `socket.data`, which came from a redeemed server-side ticket, and never from
 * the payload. `DriverLocationPing` deliberately carries no driver id at all,
 * so there is nothing in the message for a handler to be tempted by.
 */
export interface DriverClientToServerEvents {
  'location:update': (
    payload: DriverLocationPing,
    ack?: (result: DriverLocationAccepted) => void,
  ) => void;
}

export interface DriverServerToClientEvents {
  'realtime:ready': (payload: DriverReadyEvent) => void;
  'config:update': (payload: DriverConfigUpdateEvent) => void;
  /** §6.3's offer — the room this lands in is why Phase 16 built the namespace. */
  'job:offer': (payload: JobOfferEvent) => void;
  'job:revoked': (payload: JobRevokedEvent) => void;
}

/** Attached at handshake from the redeemed ticket — the only source of a socket's driver. */
export interface DriverSocketData {
  driverId: string;
}

export type DriverSocket = Socket<
  DriverClientToServerEvents,
  DriverServerToClientEvents,
  Record<string, never>,
  DriverSocketData
>;

export type DriverNamespaceType = Namespace<
  DriverClientToServerEvents,
  DriverServerToClientEvents,
  Record<string, never>,
  DriverSocketData
>;

// ---------------------------------------------------------------------------
// The `/customer` namespace (Phase 17)
// ---------------------------------------------------------------------------

/**
 * EMPTY, like `/fleet` and unlike `/driver`.
 *
 * The customer has nothing to tell the server over a socket: cancelling is a
 * REST call that needs an audit trail and an idempotency story, and everything
 * else they do is a REST mutation too. Keeping this empty is what makes adding
 * an inbound handler here a deliberate decision rather than an accident.
 */
export interface CustomerClientToServerEvents {
  // intentionally empty — see above
}

export interface CustomerServerToClientEvents {
  'realtime:ready': (payload: CustomerReadyEvent) => void;
  'search:progress': (payload: SearchProgressEvent) => void;
  'booking:status': (payload: CustomerBookingStatusEvent) => void;
  /**
   * §11.4's moving truck and §11.5's estimate (Phase 18).
   *
   * BOTH ARE ROOMED TO ONE BOOKING, like everything else on this namespace, so
   * both carry the customer's own full-precision view. §11.7's share-link
   * viewers do NOT receive these: the public page polls `GET /v1/track/:token`
   * on the §19.2 cadence instead of holding a socket — a deliberate deviation,
   * recorded in `customer/track.ts`, because an unauthenticated socket is a new
   * abuse surface opened for one read-only page.
   */
  'location:update': (payload: CustomerLocationUpdateEvent) => void;
  'eta:update': (payload: EtaUpdateEvent) => void;
}

/**
 * Attached at handshake from the redeemed ticket.
 *
 * `bookingId` is on the SOCKET, not on a message: `WsTicketService` mints it
 * only after the ticket route has proved this customer owns that booking, so
 * ownership is checked once on a route that already does it, and nothing the
 * socket says afterwards can reach a room name.
 */
export interface CustomerSocketData {
  userId: string;
  bookingId: string;
}

export type CustomerSocket = Socket<
  CustomerClientToServerEvents,
  CustomerServerToClientEvents,
  Record<string, never>,
  CustomerSocketData
>;

export type CustomerNamespaceType = Namespace<
  CustomerClientToServerEvents,
  CustomerServerToClientEvents,
  Record<string, never>,
  CustomerSocketData
>;
