/** DI token for the command connection — inject with `@Inject(REDIS)`. */
export const REDIS = Symbol('REDIS');

/**
 * DI token for a second, dedicated connection. Redis switches a client into
 * subscriber mode on the first SUBSCRIBE and from then on rejects everything
 * except (P)SUBSCRIBE/(P)UNSUBSCRIBE/PING/QUIT — sharing one client would break
 * every GET/SET in the process the moment the tracking gateway subscribed.
 *
 * `RealtimeSubscriberService` is that gateway: it owns this client and
 * multiplexes every realtime channel over its single `message` listener.
 */
export const REDIS_SUB = Symbol('REDIS_SUB');

/**
 * Internal fan-out channel for driver pings (§16.6 `location:update`). The
 * driver's socket and a customer watching the same booking routinely land on
 * different API tasks, so pings cross nodes through Redis rather than being
 * emitted directly to local sockets.
 */
export const LOCATION_CHANNEL = 'location:ping';

/**
 * Domain events that move a fleet's KPIs (truck created/updated, driver
 * assigned, booking transitioned). Producers publish here; `MetricsBroadcaster`
 * turns a burst of them into one recomputed `ops:metrics` payload.
 *
 * Separate from LOCATION_CHANNEL on purpose: pings are high-frequency and
 * disposable, domain events are rare and each one costs a DB recompute.
 */
export const FLEET_EVENTS_CHANNEL = 'fleet:events';

/**
 * Driver-shaped pings (Phase 16). Separate from `LOCATION_CHANNEL`, which
 * carries the TRUCK shape the fleet console has consumed since Phase 5.
 *
 * One ping fans out to both: the fleet adapter translates driver → truck so
 * `<FleetMap>` and its contracts stay byte-identical, and this channel carries
 * the untranslated fact for consumers that need the driver — Phase 18's
 * customer tracking, which follows a person to a pickup and has no truck id to
 * key on until assignment happens.
 */
export const DRIVER_LOCATION_CHANNEL = 'location:driver';

/** Computed KPI payloads, ready to relay verbatim to `fleet:{id}` sockets. */
export const METRICS_CHANNEL = 'ops:metrics';

/**
 * Per-truck hot position hash. Written by the ping path with a 30s TTL
 * (`TRUCK_HASH_TTL_MS` in @towing/api-contracts) and read by the positions
 * snapshot; the dispatch matcher of §6.1 reads the same key.
 */
export const truckHashKey = (truckId: string): string => `truck:${truckId}`;

/** Mirrors §6.1's `drivers:online:{zone}` shape, keyed by tenant for fleet trucks. */
export const truckGeoKey = (fleetId: string): string => `trucks:online:${fleetId}`;

/**
 * §6.1's candidate store proper (Phase 16): a GEO set of DRIVER ids per ZONE.
 *
 * NOT A RENAME OF `truckGeoKey`, AND NOT A REUSE OF IT. That key is keyed by
 * truck and by tenant, which is the right shape for one fleet's console map and
 * the wrong shape for a marketplace matcher: dispatch searches a geography for
 * anyone who can take the job, across every fleet and including the independent
 * drivers who belong to none. Both keys exist, both are written by the same ping,
 * and they answer different questions.
 *
 * GEO members carry NO per-member TTL. Membership is therefore pruned by
 * go-offline, by the liveness filter (a member whose `driver:{id}` hash has
 * expired is stale supply), and by read-repair — never by expiry. That is the
 * same lesson `PositionsService.readRepair` already encodes for trucks.
 */
export const driverGeoKey = (zoneId: string): string => `drivers:online:${zoneId}`;

/**
 * Per-driver hot state, 30s TTL (`DRIVER_HASH_TTL_MS` in @towing/api-contracts).
 *
 * Holds the last fix (lat/lng/heading/speed/accuracy/at), the monotonic `seq`
 * the pipeline orders on, and — cached at go-online — the driver's `zoneId`,
 * `fleetId`, `truckId`, vehicle class and long-distance opt-in.
 *
 * THE CACHED IDENTITY FIELDS ARE THE POINT. A ping arrives every 3s per active
 * driver; resolving `drivers.assigned_truck_id → fleets.id` from Postgres on
 * each one would put a join on the hottest path in the system. They are written
 * once when the driver goes online and re-resolved when a fleet reassigns their
 * truck.
 */
export const driverHashKey = (driverId: string): string => `driver:${driverId}`;

/**
 * §6.3's per-driver offer lock (Phase 17). Held for the offer timeout plus a
 * grace, and its EXISTENCE is the fact that matters: a driver holding a pending
 * offer is invisible to every other search.
 *
 * WHY A LOCK RATHER THAN A COLUMN. Two searches for two different bookings run
 * on two Fargate tasks and would both read "this driver has no active job" from
 * Postgres in the same millisecond, offer to them both, and hand the driver two
 * twenty-second countdowns for two customers. A `SET NX PX` is one round trip
 * and is atomic across every task; the partial unique index added in migration
 * 0014 is the backstop for the case where this lock is evicted or expires early.
 *
 * THE TTL IS THE SAFETY PROPERTY. A lock released only by code is a lock a
 * crashed worker holds forever, and a driver locked out of every search until
 * someone notices. Expiry means the worst case is one wasted offer window.
 */
export const driverOfferLockKey = (driverId: string): string => `offer:${driverId}`;

/**
 * §6.4's per-booking search lock. Serialises wave runners so two workers cannot
 * advance the same search concurrently and double the offers it makes.
 *
 * Distinct from the offer lock above and held for a far shorter time: this one
 * covers the few hundred milliseconds of selecting and offering, not the twenty
 * seconds a driver spends deciding.
 */
export const bookingSearchLockKey = (bookingId: string): string => `dispatch:lock:${bookingId}`;

/**
 * §19.4's per-booking settlement lock (Phase 19).
 *
 * Serialises the three callers that can settle one payment — the capture
 * route, the Razorpay webhook and the five-minute sweep — so two Fargate tasks
 * cannot credit one booking twice. 15 seconds: long enough for a vendor
 * `fetchPayment` plus two transactions, short enough that a crashed worker
 * frees it fast.
 *
 * DELIBERATELY NOT A CORRECTNESS DEPENDENCY. Capture and the webhook take it
 * with `required: false` and proceed without it when Redis is down, because
 * §19.2 never says a degraded cache stops payments. The guarantees that hold
 * regardless are database facts: `uq_payments_one_captured_per_booking`, the
 * state machine's FOR UPDATE legality check, and the `bk:v1:*` ledger keys.
 */
export const paymentCaptureLockKey = (bookingId: string): string => `payment:lock:${bookingId}`;

/**
 * §19.8's kill switches — Redis-backed so an operator can stop dispatch without
 * a deploy, which is the entire requirement.
 *
 * NOT env vars and not a database table. An env var needs a rolling restart,
 * which is minutes during exactly the incident where seconds matter; a table
 * needs a migration to add the next switch and a cache to be read on the hot
 * path. A Redis key is one round trip, takes effect on the next wave, and the
 * next switch is a new key.
 */
export const KILLSWITCH_PAUSED_ZONES = 'dispatch:killswitch:paused-zones';
export const KILLSWITCH_LONG_DISTANCE = 'dispatch:killswitch:long-distance-disabled';
export const KILLSWITCH_FORCE_POLLING = 'dispatch:killswitch:force-polling';

/** Single-use WebSocket handshake ticket (§16.6 handshake auth). */
export const wsTicketKey = (ticket: string): string => `ws:ticket:${ticket}`;

/**
 * Cost guard, not a correctness guard: whichever node wins this recomputes the
 * fleet's KPIs. Losing it costs one skipped push, which the console's 15s
 * staleTime and its on-reconnect REST resync already cover.
 */
export const metricsLockKey = (fleetId: string): string => `ops:metrics:lock:${fleetId}`;
