import { Inject, Injectable } from '@nestjs/common';
import {
  commissionPaiseAtPct,
  type AdminQuote,
  type AdminQuoteDecision,
  type AdminQuoteReject,
  type AdminQuotesQuery,
  type AdminQuotesResponse,
  type Quote,
  type QuoteAcceptResponse,
  type QuoteRequest,
  type QuotesResponse,
} from '@towing/api-contracts';
import { and, eq, sql } from 'drizzle-orm';
import { ApiException } from '../../common/errors/api-exception';
import { DB, type Database } from '../../db/db.module';
import { quotes, users } from '../../db/schema';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { PricingConfigRepo } from '../pricing/pricing-config.repo';
import { PricingService } from '../pricing/pricing.service';
import type { VehicleClass } from '../pricing/pricing.math';

const DEFAULT_VALID_HOURS = 48;

interface QuoteRow {
  id: string;
  user_id: string;
  status: string;
  service_slug: string;
  vehicle_class: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_address: string | null;
  distance_km: string;
  notes: string | null;
  total_paise: string | number | null;
  breakdown: { note?: string; source?: string } | null;
  commission_pct: string | null;
  quoted_by: string | null;
  quoted_at: string | Date | null;
  valid_until: string | Date | null;
  rejection_reason: string | null;
  decided_at: string | Date | null;
  booking_id: string | null;
  requested_at: string | Date;
  user_name?: string | null;
  user_mobile?: string | null;
  total_count?: string | number;
}

/**
 * W20 — §7.3's manual-quote lane.
 *
 * THE CUSTOMER DRIVES THE REQUEST, THE OPERATOR DRIVES THE PRICE, AND THE
 * CUSTOMER DRIVES THE ACCEPTANCE. Three actors, three routes, and no path
 * where a booking exists without an accepted quote or a quote exists without a
 * request.
 *
 * WHY ACCEPT RUNS THROUGH `BookingsService.create` INSTEAD OF INSERTING A
 * BOOKING HERE: the booking row is the fare lock (§3.4) plus the account
 * guards plus the OTP plus the kill switches, and a second creation path is how
 * a booking ends up missing one of them. Accept passes the quote as a
 * pre-locked fare (`options.locked`) so the engine is never consulted — a 900
 * km job would throw `manual_quote_required` at the exact moment the customer
 * accepted the price — while every snapshot column, the commission arithmetic
 * and the tax remain the same code that books a 5 km tow.
 *
 * THE ACCEPT IS A CONDITIONAL UPDATE FIRST, BOOKING SECOND. Two taps (or two
 * devices) must produce ONE booking: `where status = 'quoted'` is the gate,
 * and only the winner goes on to create. If the booking itself then fails
 * (an open trip, a suspended account), the quote is put back so the customer's
 * offer is not eaten by a transient refusal.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly pricing: PricingService,
    private readonly rateCards: PricingConfigRepo,
    private readonly bookings: BookingsService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── Customer lane ─────────────────────────────────────────────────────────

  async request(userId: string, body: QuoteRequest): Promise<Quote> {
    const [account] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account) throw ApiException.unauthorized();
    if (account.status !== 'active') {
      // Same §3.7 rule the booking route applies: a suspended account does not
      // get to open new commercial conversations either.
      throw new ApiException(403, 'account_not_active', 'This account cannot request quotes.');
    }

    const distanceKm = await this.pricing.quoteDistanceKm(body.pickup, body.drop);

    const [inserted] = await this.db
      .insert(quotes)
      .values({
        userId,
        serviceSlug: body.serviceSlug,
        vehicleClass: body.vehicleClass ?? 'flatbed',
        pickupLat: body.pickup.lat,
        pickupLng: body.pickup.lng,
        pickupAddress: body.pickupAddress ?? null,
        dropLat: body.drop.lat,
        dropLng: body.drop.lng,
        dropAddress: body.dropAddress ?? null,
        distanceKm: distanceKm.toFixed(2),
        notes: body.notes ?? null,
      })
      .returning({ id: quotes.id });

    // Re-read through the ONE snake_case mapper (`loadRow`) rather than mapping
    // the drizzle row inline: a `.returning()` row is camelCase, and two
    // mappers is how one of them silently starts returning nulls.
    return toQuote(await this.loadRow(inserted!.id));
  }

  async list(userId: string): Promise<QuotesResponse> {
    const rows = (await this.db.execute(sql`
      select * from quotes where user_id = ${userId} order by requested_at desc, id desc
    `)) as unknown as QuoteRow[];

    return { items: rows.map(toQuote) };
  }

  async accept(userId: string, quoteId: string): Promise<QuoteAcceptResponse> {
    const [row] = (await this.db.execute(sql`
      select * from quotes where id = ${quoteId} and user_id = ${userId} limit 1
    `)) as unknown as QuoteRow[];
    // 404 rather than 403 for someone else's quote: a customer has no business
    // learning that an id exists.
    if (!row) throw ApiException.notFound('Quote not found');

    if (row.status !== 'quoted') {
      // An offer that lapsed flips to `expired` ON the refusal, so the customer
      // (and the queue) see why instead of a generic conflict.
      if (row.status === 'requested' && row.valid_until === null) {
        throw ApiException.conflict('This request has not been quoted yet');
      }
      throw ApiException.conflict(`This quote cannot be accepted (it is ${row.status})`);
    }

    if (row.valid_until !== null && new Date(row.valid_until).getTime() <= Date.now()) {
      await this.db
        .update(quotes)
        .set({ status: 'expired', decidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(quotes.id, quoteId), eq(quotes.status, 'quoted')));
      throw ApiException.conflict('This quote has expired — request a new one');
    }

    // The gate: exactly one acceptance wins.
    const [claimed] = await this.db
      .update(quotes)
      .set({ status: 'accepted', decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(quotes.id, quoteId), eq(quotes.status, 'quoted')))
      .returning({ id: quotes.id });
    if (!claimed) throw ApiException.conflict('This quote was already accepted');

    const totalPaise = Number(row.total_paise ?? 0);
    const commissionPct = Number(row.commission_pct ?? 0);

    try {
      const locked = await this.pricing.lockManualQuote(
        {
          serviceSlug: row.service_slug,
          vehicleClass: row.vehicle_class as VehicleClass,
          pickup: { lat: row.pickup_lat, lng: row.pickup_lng },
          drop: { lat: row.drop_lat ?? 0, lng: row.drop_lng ?? 0 },
        },
        totalPaise,
        commissionPct,
      );

      const booking = await this.bookings.create(
        userId,
        {
          serviceSlug: row.service_slug,
          vehicleClass: row.vehicle_class as VehicleClass,
          pickup: { lat: row.pickup_lat, lng: row.pickup_lng },
          pickupAddress: row.pickup_address ?? coordsLabel(row.pickup_lat, row.pickup_lng),
          // `drop` is guaranteed by the request contract; the fallbacks only
          // keep the types honest.
          drop: { lat: row.drop_lat ?? 0, lng: row.drop_lng ?? 0 },
          dropAddress: row.drop_address ?? coordsLabel(row.drop_lat ?? 0, row.drop_lng ?? 0),
          ...(row.notes ? { note: row.notes } : {}),
        },
        { locked },
      );

      const [updated] = await this.db
        .update(quotes)
        .set({ bookingId: booking.id, updatedAt: new Date() })
        .where(eq(quotes.id, quoteId))
        .returning({ id: quotes.id });

      return { booking, quote: toQuote(await this.loadRow(updated!.id)) };
    } catch (error) {
      // The booking was refused (open trip, paused zone, unpaid balance). Put
      // the offer back: the customer said yes to a price, and a transient
      // refusal must not burn it.
      await this.db
        .update(quotes)
        .set({ status: 'quoted', decidedAt: null, updatedAt: new Date() })
        .where(eq(quotes.id, quoteId));
      throw error;
    }
  }

  // ── Admin lane ────────────────────────────────────────────────────────────

  async adminList(query: AdminQuotesQuery): Promise<AdminQuotesResponse> {
    const statusFilter = query.status ? sql`and q.status = ${query.status}` : sql``;
    const offset = (query.page - 1) * query.limit;

    const rows = (await this.db.execute(sql`
      select q.*, u.name as user_name, u.mobile as user_mobile,
             count(*) over() as total_count
        from quotes q
        left join users u on u.id = q.user_id
       where true ${statusFilter}
       order by q.requested_at desc, q.id desc
       limit ${query.limit} offset ${offset}
    `)) as unknown as QuoteRow[];

    return {
      items: rows.map(toAdminQuote),
      page: query.page,
      limit: query.limit,
      total: Number(rows[0]?.total_count ?? 0),
    };
  }

  async quotePrice(
    adminId: string,
    quoteId: string,
    body: AdminQuoteDecision,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<AdminQuote> {
    const before = await this.requireStatus(quoteId, ['requested', 'quoted']);

    // The commission comes off the rate card — the SAME source `lock()` reads —
    // and is written onto the row so acceptance cannot re-price a job the
    // customer already saw (§3.4's rule, applied to the manual lane).
    const rateCard = await this.rateCards.load();
    const commissionPct = rateCard.commissionPct['C'];
    const commissionPaise = commissionPaiseAtPct(body.totalPaise, commissionPct);
    const now = new Date();
    const validHours = body.validHours ?? DEFAULT_VALID_HOURS;

    await this.db
      .update(quotes)
      .set({
        status: 'quoted',
        totalPaise: body.totalPaise,
        breakdown: {
          source: 'manual',
          ...(body.note ? { note: body.note } : {}),
        },
        commissionPct: commissionPct.toFixed(2),
        commissionPaise,
        driverPayoutPaise: body.totalPaise - commissionPaise,
        quotedBy: adminId,
        quotedAt: now,
        validUntil: new Date(now.getTime() + validHours * 3_600_000),
        rejectionReason: null,
        updatedAt: now,
      })
      .where(eq(quotes.id, quoteId));

    await this.audit.record({
      adminId,
      action: 'quote.quote',
      subjectType: 'quote',
      subjectId: quoteId,
      before: { status: before.status, totalPaise: before.totalPaise },
      after: {
        status: 'quoted',
        totalPaise: body.totalPaise,
        commissionPct,
        validHours,
      },
      reason: body.note ?? null,
      ...context,
    });

    return this.adminDetail(quoteId);
  }

  async reject(
    adminId: string,
    quoteId: string,
    body: AdminQuoteReject,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<AdminQuote> {
    const before = await this.requireStatus(quoteId, ['requested', 'quoted']);

    await this.db
      .update(quotes)
      .set({
        status: 'rejected',
        rejectionReason: body.reason,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));

    await this.audit.record({
      adminId,
      action: 'quote.reject',
      subjectType: 'quote',
      subjectId: quoteId,
      before: { status: before.status },
      after: { status: 'rejected' },
      reason: body.reason,
      ...context,
    });

    return this.adminDetail(quoteId);
  }

  /** Housekeeping for a request or an offer nobody acted on in time. */
  async expire(
    adminId: string,
    quoteId: string,
    context: { ip?: string | null; userAgent?: string | null },
  ): Promise<AdminQuote> {
    const before = await this.requireStatus(quoteId, ['requested', 'quoted']);

    await this.db
      .update(quotes)
      .set({ status: 'expired', decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));

    await this.audit.record({
      adminId,
      action: 'quote.expire',
      subjectType: 'quote',
      subjectId: quoteId,
      before: { status: before.status },
      after: { status: 'expired' },
      ...context,
    });

    return this.adminDetail(quoteId);
  }

  async adminDetail(quoteId: string): Promise<AdminQuote> {
    const [row] = (await this.db.execute(sql`
      select q.*, u.name as user_name, u.mobile as user_mobile
        from quotes q
        left join users u on u.id = q.user_id
       where q.id = ${quoteId}
       limit 1
    `)) as unknown as QuoteRow[];
    if (!row) throw ApiException.notFound('Quote not found');
    return toAdminQuote(row);
  }

  /**
   * One loader, one row shape. Raw `select *` returns snake_case columns and
   * string timestamps; the drizzle builder returns camelCase and `Date`s.
   * Mapping both would guarantee two mappers and one bug, so every write that
   * needs its result reads it back through here.
   */
  private async loadRow(quoteId: string): Promise<QuoteRow> {
    const [row] = (await this.db.execute(sql`
      select * from quotes where id = ${quoteId} limit 1
    `)) as unknown as QuoteRow[];
    if (!row) throw ApiException.notFound('Quote not found');
    return row;
  }

  private async requireStatus(quoteId: string, allowed: readonly string[]) {
    const [row] = (await this.db.execute(sql`
      select id, status, total_paise from quotes where id = ${quoteId} limit 1
    `)) as unknown as Array<{ id: string; status: string; total_paise: string | number | null }>;
    if (!row) throw ApiException.notFound('Quote not found');
    if (!allowed.includes(row.status)) {
      throw ApiException.conflict(
        `This quote is ${row.status}; that action needs one of ${allowed.join(', ')}`,
      );
    }
    return { status: row.status, totalPaise: row.total_paise === null ? null : Number(row.total_paise) };
  }
}

function coordsLabel(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** Raw `db.execute` hands timestamps back as strings — normalise once, here. */
function iso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toQuote(row: QuoteRow): Quote {
  return {
    id: row.id,
    status: row.status as Quote['status'],
    serviceSlug: row.service_slug,
    vehicleClass: row.vehicle_class,
    pickup: { lat: row.pickup_lat, lng: row.pickup_lng },
    pickupAddress: row.pickup_address,
    drop: row.drop_lat === null || row.drop_lng === null ? null : { lat: row.drop_lat, lng: row.drop_lng },
    dropAddress: row.drop_address,
    distanceKm: Number(row.distance_km),
    notes: row.notes,
    totalPaise: row.total_paise === null ? null : Number(row.total_paise),
    quoteNote: row.breakdown?.note ?? null,
    validUntil: iso(row.valid_until),
    quotedAt: iso(row.quoted_at),
    decidedAt: iso(row.decided_at),
    bookingId: row.booking_id,
    requestedAt: iso(row.requested_at)!,
  };
}

function toAdminQuote(row: QuoteRow): AdminQuote {
  return {
    ...toQuote(row),
    userLabel: row.user_name ?? (row.user_mobile ? `******${row.user_mobile.slice(-4)}` : null),
    quotedBy: row.quoted_by,
    rejectionReason: row.rejection_reason,
  };
}
