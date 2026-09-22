import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  AdminSosAlert,
  AdminSosContact,
  AdminSosEvent,
  AdminSosQuery,
} from '@towing/api-contracts';
import { DB, type Database } from '../../db/db.module';
import { adminUsers } from '../../db/schema/admin';
import { bookings } from '../../db/schema/bookings';
import { drivers } from '../../db/schema/drivers';
import { sosAlertContacts, sosAlertEvents, sosAlerts } from '../../db/schema/sos';
import { users } from '../../db/schema/users';
import { ACTIVE_JOB_STATUSES } from '../bookings/booking-state-machine.service';

/** What the console shows about the person an alert belongs to. */
export interface SubjectSnapshot {
  name: string | null;
  mobile: string | null;
  /** Best known position — the fallback an ops-raised alert uses. */
  lat: number | null;
  lng: number | null;
}

export interface BookingRef {
  id: string;
  /** `TW-…` display code, derived the same way the templates derive `reference`. */
  code: string;
  status: string;
}

/** The shape `alertColumns()` selects — the alert plus its joined subject and booking. */
interface AlertJoinRow {
  id: string;
  subjectType: string;
  subjectId: string;
  userName: string | null;
  userMobile: string | null;
  driverName: string | null;
  driverMobile: string | null;
  bookingId: string | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
  source: string;
  status: string;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `TW-3F9A21B4` — the same derivation every console and template uses. */
export const bookingCode = (bookingId: string): string =>
  `TW-${bookingId.slice(0, 8).toUpperCase()}`;

/**
 * Reads over the three SOS tables plus the polymorphic subject lookups the
 * console needs. Writes with transactional meaning live in the service; this
 * is the query surface.
 */
@Injectable()
export class SosRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  // -------------------------------------------------------------------------
  // Subjects + bookings
  // -------------------------------------------------------------------------

  /**
   * The subject behind `user|driver`. A driver's position is their last ping —
   * which is exactly what an operator raising an alert from a phone call wants
   * to see; a customer's is the home pin they saved, if any.
   */
  async findSubject(subjectType: string, subjectId: string): Promise<SubjectSnapshot | null> {
    if (subjectType === 'user') {
      const [row] = await this.db
        .select({
          name: users.name,
          mobile: users.mobile,
          lat: users.defaultLat,
          lng: users.defaultLng,
        })
        .from(users)
        .where(eq(users.id, subjectId))
        .limit(1);
      return row ?? null;
    }

    const [row] = await this.db
      .select({
        name: drivers.name,
        mobile: drivers.mobile,
        currentLocation: drivers.currentLocation,
      })
      .from(drivers)
      .where(eq(drivers.id, subjectId))
      .limit(1);
    if (!row) return null;
    return {
      name: row.name,
      mobile: row.mobile,
      lat: row.currentLocation?.lat ?? null,
      lng: row.currentLocation?.lng ?? null,
    };
  }

  /** The subject's live job, when there is one — the alert links it automatically. */
  async findActiveBooking(subjectType: string, subjectId: string): Promise<BookingRef | null> {
    const [row] = await this.db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(this.subjectFilter(subjectType, subjectId), activeStatusFilter()))
      .orderBy(desc(bookings.createdAt))
      .limit(1);
    return row ? { id: row.id, code: bookingCode(row.id), status: row.status } : null;
  }

  /**
   * A booking the subject owns, in any status. Ownership is the security check
   * — an alert may cite the trip it happened during, and a customer must not
   * be able to attach somebody else's booking id to theirs.
   */
  async findOwnedBooking(
    subjectType: string,
    subjectId: string,
    bookingId: string,
  ): Promise<BookingRef | null> {
    const [row] = await this.db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), this.subjectFilter(subjectType, subjectId)))
      .limit(1);
    return row ? { id: row.id, code: bookingCode(row.id), status: row.status } : null;
  }

  /** The open incident for a subject, if any — the trigger's idempotency read. */
  async openAlertForSubject(
    subjectType: string,
    subjectId: string,
  ): Promise<{ id: string; status: string; createdAt: Date } | null> {
    const [row] = await this.db
      .select({ id: sosAlerts.id, status: sosAlerts.status, createdAt: sosAlerts.createdAt })
      .from(sosAlerts)
      .where(
        and(
          eq(sosAlerts.subjectType, subjectType),
          eq(sosAlerts.subjectId, subjectId),
          inArray(sosAlerts.status, ['triggered', 'acknowledged']),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // -------------------------------------------------------------------------
  // Queue + detail
  // -------------------------------------------------------------------------

  async list(query: AdminSosQuery): Promise<{ items: AdminSosAlert[]; total: number }> {
    const where = this.queueWhere(query);
    const offset = (query.page - 1) * query.limit;

    const rows = await this.db
      .select(this.alertColumns())
      .from(sosAlerts)
      .leftJoin(users, and(eq(users.id, sosAlerts.subjectId), eq(sosAlerts.subjectType, 'user')))
      .leftJoin(
        drivers,
        and(eq(drivers.id, sosAlerts.subjectId), eq(sosAlerts.subjectType, 'driver')),
      )
      .leftJoin(bookings, eq(bookings.id, sosAlerts.bookingId))
      .where(where)
      .orderBy(desc(sosAlerts.createdAt))
      .limit(query.limit)
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sosAlerts)
      .where(where);

    const items = await this.withAckNames(rows.map((row) => this.toAlert(row)));

    return { items, total: countRow?.count ?? 0 };
  }

  async alertById(id: string): Promise<AdminSosAlert | null> {
    const rows = await this.db
      .select(this.alertColumns())
      .from(sosAlerts)
      .leftJoin(users, and(eq(users.id, sosAlerts.subjectId), eq(sosAlerts.subjectType, 'user')))
      .leftJoin(
        drivers,
        and(eq(drivers.id, sosAlerts.subjectId), eq(sosAlerts.subjectType, 'driver')),
      )
      .leftJoin(bookings, eq(bookings.id, sosAlerts.bookingId))
      .where(eq(sosAlerts.id, id))
      .limit(1);

    const [row] = rows;
    if (!row) return null;
    const [alert] = await this.withAckNames([this.toAlert(row)]);
    return alert ?? null;
  }

  async contactsFor(alertId: string): Promise<AdminSosContact[]> {
    const rows = await this.db
      .select({
        id: sosAlertContacts.id,
        name: sosAlertContacts.name,
        phone: sosAlertContacts.phone,
        relation: sosAlertContacts.relation,
        notifiedChannels: sosAlertContacts.notifiedChannels,
      })
      .from(sosAlertContacts)
      .where(eq(sosAlertContacts.alertId, alertId))
      .orderBy(sosAlertContacts.createdAt);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      relation: row.relation,
      notifiedChannels: (row.notifiedChannels ?? []) as AdminSosContact['notifiedChannels'],
    }));
  }

  async eventsFor(alertId: string): Promise<AdminSosEvent[]> {
    const rows = await this.db
      .select({
        id: sosAlertEvents.id,
        kind: sosAlertEvents.kind,
        actorType: sosAlertEvents.actorType,
        actorId: sosAlertEvents.actorId,
        note: sosAlertEvents.note,
        data: sosAlertEvents.data,
        createdAt: sosAlertEvents.createdAt,
      })
      .from(sosAlertEvents)
      .where(eq(sosAlertEvents.alertId, alertId))
      .orderBy(sosAlertEvents.createdAt);

    const names = await this.adminNames(
      rows.map((row) => row.actorId).filter((id): id is string => id !== null),
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as AdminSosEvent['kind'],
      actorType: row.actorType as AdminSosEvent['actorType'],
      actorId: row.actorId,
      actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
      note: row.note,
      data: (row.data ?? null) as Record<string, unknown> | null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private subjectFilter(subjectType: string, subjectId: string): SQL {
    return subjectType === 'user'
      ? eq(bookings.userId, subjectId)
      : eq(bookings.driverId, subjectId);
  }

  private queueWhere(query: AdminSosQuery): SQL | undefined {
    const conditions: SQL[] = [];
    if (query.open) {
      conditions.push(inArray(sosAlerts.status, ['triggered', 'acknowledged']));
    } else if (query.status) {
      conditions.push(eq(sosAlerts.status, query.status));
    }
    if (query.subjectType) conditions.push(eq(sosAlerts.subjectType, query.subjectType));
    // IST day boundaries — the finance console's rule, for the same reason:
    // "today" is an operator's day in ap-south, not a UTC one.
    if (query.from) {
      conditions.push(
        sql`${sosAlerts.createdAt} >= (${query.from}::date::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    if (query.to) {
      conditions.push(
        sql`${sosAlerts.createdAt} < ((${query.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`,
      );
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  private alertColumns() {
    return {
      id: sosAlerts.id,
      subjectType: sosAlerts.subjectType,
      subjectId: sosAlerts.subjectId,
      userName: users.name,
      userMobile: users.mobile,
      driverName: drivers.name,
      driverMobile: drivers.mobile,
      bookingId: sosAlerts.bookingId,
      lat: sosAlerts.lat,
      lng: sosAlerts.lng,
      accuracyM: sosAlerts.accuracyM,
      source: sosAlerts.source,
      status: sosAlerts.status,
      acknowledgedBy: sosAlerts.acknowledgedBy,
      acknowledgedAt: sosAlerts.acknowledgedAt,
      resolvedBy: sosAlerts.resolvedBy,
      resolvedAt: sosAlerts.resolvedAt,
      resolution: sosAlerts.resolution,
      createdAt: sosAlerts.createdAt,
      updatedAt: sosAlerts.updatedAt,
    };
  }

  private toAlert(row: AlertJoinRow): AdminSosAlert {
    const isUser = row.subjectType === 'user';
    return {
      id: row.id,
      subjectType: row.subjectType as AdminSosAlert['subjectType'],
      subjectId: row.subjectId,
      subjectName: (isUser ? row.userName : row.driverName) ?? null,
      subjectMobile: (isUser ? row.userMobile : row.driverMobile) ?? null,
      bookingId: row.bookingId,
      bookingCode: row.bookingId ? bookingCode(row.bookingId) : null,
      lat: row.lat,
      lng: row.lng,
      accuracyM: row.accuracyM,
      source: row.source as AdminSosAlert['source'],
      status: row.status as AdminSosAlert['status'],
      acknowledgedBy: row.acknowledgedBy,
      acknowledgedByName: null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolution: row.resolution,
      ackSeconds: ackSeconds(row.createdAt, row.acknowledgedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Fills `acknowledgedByName` with one batched read — no alias juggling. */
  private async withAckNames(items: AdminSosAlert[]): Promise<AdminSosAlert[]> {
    const ids = items.map((item) => item.acknowledgedBy).filter((id): id is string => id !== null);
    if (ids.length === 0) return items;
    const names = await this.adminNames(ids);
    return items.map((item) => ({
      ...item,
      acknowledgedByName: item.acknowledgedBy ? (names.get(item.acknowledgedBy) ?? null) : null,
    }));
  }

  private async adminNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({ id: adminUsers.id, name: adminUsers.name })
      .from(adminUsers)
      .where(inArray(adminUsers.id, unique));
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

/** `ACTIVE_JOB_STATUSES` as a drizzle condition, same list the state machine uses. */
function activeStatusFilter(): SQL {
  return inArray(bookings.status, [...ACTIVE_JOB_STATUSES]);
}

function ackSeconds(createdAt: Date, acknowledgedAt: Date | null): number | null {
  if (!acknowledgedAt) return null;
  return Math.max(0, Math.round((acknowledgedAt.getTime() - createdAt.getTime()) / 1000));
}
