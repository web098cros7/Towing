import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { adminSubRoleSchema, type AdminSubRole, type FleetId } from '@towing/api-contracts';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS, wsTicketKey } from '../redis/redis.constants';

/**
 * Who a redeemed ticket is. Widened in Phase 16 from `{ fleetId, userId }` to
 * carry a REALM, because there are now two namespaces and a ticket minted for
 * one must not open a socket on the other.
 *
 * `realm` is not decoration: `DriverGateway` refuses anything that is not
 * `driver` and `FleetGateway` refuses anything that is not `fleet`. Without it
 * a fleet owner's ticket would satisfy the driver handshake's "there is a
 * subject id here" check and land them in a `driver:{id}` room keyed on their
 * own user id — reading another realm's offers.
 */
export type WsTicketClaims =
  | {
      realm: 'fleet';
      /** The console's tenant. The ONLY thing that decides a fleet socket's room. */
      fleetId: FleetId;
      /** `fleet_users.id` — who is watching, for the connection log. */
      subjectId: string;
    }
  | {
      realm: 'driver';
      /** `drivers.id`. Decides the `driver:{id}` room and nothing else does. */
      subjectId: string;
    }
  | {
      realm: 'customer';
      /** `users.id` — who is watching. */
      subjectId: string;
      /**
       * The booking this socket may watch, decided HERE rather than by anything
       * the socket says later (Phase 17).
       *
       * The ticket route proves ownership before minting, so the expensive
       * check happens once on a route that was already doing it, and the
       * gateway's room join needs no authorization logic of its own. A customer
       * with a stolen booking id cannot mint a ticket for it, and a customer
       * with a valid ticket cannot redirect it at another booking.
       */
      bookingId: string;
    }
  | {
      realm: 'admin';
      /** `admin_users.id` — decides the `admin:user:{id}` room and nothing else. */
      subjectId: string;
      /**
       * §4.2 sub-role, carried so `realtime:ready` needs no extra DB read and
       * W1's badge/subscription logic can reason about the viewer without one.
       * The socket is deliberately NOT scoped by it — permissions are enforced
       * per route and per frame emission, not by room membership.
       */
      subRole: AdminSubRole;
    };

/**
 * Single-use handshake tickets for the WebSocket connection.
 *
 * WHY NOT A SHORT-TTL JWT: `JwtAuthGuard` accepts any token signed with
 * `JWT_ACCESS_SECRET` that carries `role: 'fleet_owner'`. A ticket minted that
 * way would be a fully-privileged access token in disguise, and the only fixes
 * are a `typ` claim the guard must remember to reject, or a second secret. An
 * opaque random string in Redis has neither problem, and gains single-use
 * semantics and instant revocability for free.
 *
 * The browser is why this exists at all: it holds only httpOnly cookies, so it
 * physically cannot put a bearer on the handshake.
 */
@Injectable()
export class WsTicketService {
  private readonly logger = new Logger(WsTicketService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get ttlSeconds(): number {
    return this.env.REALTIME_TICKET_TTL_SECONDS;
  }

  async issue(claims: WsTicketClaims): Promise<string> {
    // 32 bytes: the ticket is a bearer credential for its whole (short) life, so
    // it gets the same entropy as a refresh token rather than a session id.
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(wsTicketKey(ticket), JSON.stringify(claims), 'EX', this.ttlSeconds);
    return ticket;
  }

  /**
   * Redeems a ticket, returning null for anything that is not a live,
   * unredeemed one. GETDEL makes redemption atomic: two sockets racing the same
   * stolen ticket cannot both connect. (Redis >= 6.2; both compose profiles and
   * ElastiCache run 7.)
   */
  async consume(ticket: unknown): Promise<WsTicketClaims | null> {
    if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 256) return null;

    let raw: string | null;
    try {
      raw = await this.redis.getdel(wsTicketKey(ticket));
    } catch (err) {
      // Availability-first would be wrong here: failing open on an auth check
      // is how tenants leak into each other's rooms.
      this.logger.error(
        `ticket lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (raw === null) return null;

    try {
      return narrowClaims(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}

/**
 * Hand-narrowed rather than zod-parsed, deliberately: this value was written by
 * THIS service into a key only it can name, so the risk being defended against
 * is a deploy that changed the shape while old tickets were still in flight —
 * not a hostile payload. Returning null there logs the holder out for the
 * ticket's remaining seconds, which is the correct amount of drama.
 */
function narrowClaims(parsed: unknown): WsTicketClaims | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const claims = parsed as Partial<Record<string, unknown>>;
  if (typeof claims.subjectId !== 'string' || claims.subjectId.length === 0) return null;

  if (claims.realm === 'driver') {
    return { realm: 'driver', subjectId: claims.subjectId };
  }

  if (
    claims.realm === 'customer' &&
    typeof claims.bookingId === 'string' &&
    claims.bookingId.length > 0
  ) {
    return { realm: 'customer', subjectId: claims.subjectId, bookingId: claims.bookingId };
  }

  // W1 (§3.4): the fourth realm. The sub-role is validated against the same
  // enum the database and the permission map use — a ticket carrying a
  // half-written value falls out here and the socket is refused, rather than
  // joining the namespace with a claim nothing can reason about.
  if (claims.realm === 'admin') {
    const subRole = adminSubRoleSchema.safeParse(claims.subRole);
    if (subRole.success)
      return { realm: 'admin', subjectId: claims.subjectId, subRole: subRole.data };
  }

  if (claims.realm === 'fleet' && typeof claims.fleetId === 'string' && claims.fleetId.length > 0) {
    return { realm: 'fleet', fleetId: claims.fleetId as FleetId, subjectId: claims.subjectId };
  }

  return null;
}
