import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_TRANSITION_EDGES,
  ErrorCodes,
  paiseToRupeeString,
  rupeeStringToPaise,
  type AdminBookingCancelBody,
  type AdminBookingCancelResponse,
  type AdminBookingDetail,
  type AdminBookingInvoice,
  type AdminBookingReassignBody,
  type AdminBookingReassignResponse,
  type AdminBookingRecheckResponse,
  type AdminBookingRemindResponse,
  type AdminBookingSummary,
  type AdminBookingTransitionBody,
  type AdminBookingTransitionResponse,
  type AdminBookingsQuery,
  type AdminBookingsResponse,
  type JobStatus,
} from '@towing/api-contracts';
import type { Response } from 'express';
import { streamCsv } from '../../common/csv/csv';
import { ApiException } from '../../common/errors/api-exception';
import { NotificationService } from '../../common/notifications/notification.service';
import { QUEUE, type QueuePort } from '../../common/queue/queue.port';
import { istDayStart } from '../../common/time/ist';
import { DB, type Database } from '../../db/db.module';
import { ledgerKeys } from '../../db/ledger/idempotency-keys';
import { LedgerService } from '../../db/ledger/ledger.service';
import { AdminAuditService } from '../admin-auth/admin-audit.service';
import { BookingOtpService } from '../bookings/booking-otp.service';
import { BookingStateMachineService } from '../bookings/booking-state-machine.service';
import { cancellationPolicy } from '../bookings/cancellation-policy';
import { CouponsService } from '../coupons/coupons.service';
import { DispatchRepo } from '../dispatch/dispatch.repo';
import { DispatchService } from '../dispatch/dispatch.service';
import { OfferService } from '../dispatch/offer.service';
import { InvoiceService } from '../invoices/invoice.service';
import { JobExecutionService } from '../job-execution/job-execution.service';
import { PaymentReconcileService } from '../money/payment-reconcile.service';
import { PricingConfigRepo } from '../pricing/pricing-config.repo';
import { AssignmentCacheService } from '../tracking/assignment-cache.service';
import { EtaService } from '../tracking/eta.service';
import type { SessionContext } from '../auth/token.service';
import { AdminBookingsRepo } from './admin-bookings.repo';

/**
 * W8's bookings console (§9.4.7, §6.5, §14.2).
 *
 * THE THREE RULES THIS SERVICE EXISTS TO KEEP:
 *
 *  1. **Cancel is pre-payment only, and waives by default (G4).** A booking
 *     that reached `completed`/`paid` has money or a dispute ahead of it, and
 *     the 409 says so and points at the dispute route; charging a customer
 *     whose cancellation an operator performed is chasing money ops cannot
 *     collect.
 *  2. **Reassign is §6.5's six steps, in order** — revoke, transition with the
 *     unable patch, record the attempt, invalidate the caches, re-dispatch (or
 *     offer). `driverFault` is what decides whether the previous driver's
 *     attempt lands as `unable` (feeds their completion rate) or `reassigned`
 *     (does not) — the one field an operator must get right.
 *  3. **The manual override can never touch money.** The allowlist is imported
 *     from the contract, and `in_progress → completed` is routed through
 *     `JobExecutionService.completeByAdmin` so §7.4's waiting charge bills from
 *     the booking's snapshot, not from a second copy of the arithmetic.
 *
 * Side effects follow the codebase's order: transition (with its audit trail
 * in `booking_status_history`) first, then the money/ledger, then sockets and
 * queues — nothing after the commit may undo it.
 */
@Injectable()
export class AdminBookingsService {
  private readonly logger = new Logger(AdminBookingsService.name);

  /** The pre-payment states an operator may cancel; everything else 409s. */
  private static readonly CANCELLABLE: readonly JobStatus[] = [
    'searching',
    'no_drivers_found',
    'assigned',
    'en_route',
    'arrived',
    'in_progress',
  ];

  /** States a booking can be REASSIGNED from — it must hold a driver. */
  private static readonly REASSIGNABLE: readonly JobStatus[] = [
    'assigned',
    'en_route',
    'arrived',
    'in_progress',
  ];

  constructor(
    private readonly repo: AdminBookingsRepo,
    private readonly machine: BookingStateMachineService,
    private readonly otp: BookingOtpService,
    private readonly coupons: CouponsService,
    private readonly ledger: LedgerService,
    private readonly rateCards: PricingConfigRepo,
    private readonly dispatch: DispatchService,
    private readonly dispatchRepo: DispatchRepo,
    private readonly offers: OfferService,
    private readonly assignments: AssignmentCacheService,
    private readonly eta: EtaService,
    private readonly jobs: JobExecutionService,
    private readonly audit: AdminAuditService,
    private readonly payments: PaymentReconcileService,
    private readonly notifications: NotificationService,
    private readonly invoices: InvoiceService,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(DB) private readonly db: Database,
  ) {}

  async list(query: AdminBookingsQuery): Promise<AdminBookingsResponse> {
    const result = await this.repo.search({
      query,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    return { ...result, page: query.page, limit: query.limit };
  }

  async detail(bookingId: string): Promise<AdminBookingDetail> {
    const detail = await this.repo.detail(bookingId);
    if (!detail) throw ApiException.notFound('Booking not found');
    return detail;
  }

  /**
   * §9.4.7's CSV export, honouring the same filters as the list.
   *
   * Capped at 5000 rows and honest about it: the fleet-side exports stream with
   * a keyset cursor, but this list is offset-paged, and "export every booking
   * ever" is a data-warehouse request rather than a console button. The cap
   * matches the widest page a human plausibly reconciles; a narrower date
   * range is the documented remedy.
   */
  private static readonly EXPORT_CAP = 5000;

  async exportCsv(query: AdminBookingsQuery, res: Response): Promise<void> {
    const { items } = await this.repo.search({
      query,
      limit: AdminBookingsService.EXPORT_CAP,
      offset: 0,
    });

    let done = false;
    await streamCsv(
      res,
      { filename: 'towfleet-bookings.csv', header: BOOKING_CSV_HEADER },
      async () => {
        if (done) return [];
        done = true;
        return items.map(toCsvCells);
      },
    );
  }

  /**
   * `GET :id/invoice` — the admin path through the invoice service. Audited on
   * every call: the URL it returns grants the document to anyone holding it
   * for five minutes, so "who looked" belongs in `admin_actions`.
   */
  async invoiceLink(
    adminId: string,
    bookingId: string,
    context: SessionContext,
  ): Promise<AdminBookingInvoice> {
    const row = await this.repo.actionRow(bookingId);
    if (!row) throw ApiException.notFound('Booking not found');

    const link = await this.invoices.adminLink(bookingId);

    await this.audit.record({
      adminId,
      action: 'booking.invoice.view',
      subjectType: 'booking',
      subjectId: bookingId,
      reason: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return link;
  }

  async cancel(
    adminId: string,
    bookingId: string,
    body: AdminBookingCancelBody,
    context: SessionContext,
  ): Promise<AdminBookingCancelResponse> {
    const row = await this.repo.actionRow(bookingId);
    if (!row) throw ApiException.notFound('Booking not found');

    if (!AdminBookingsService.CANCELLABLE.includes(row.status)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        ['completed', 'paid', 'disputed'].includes(row.status)
          ? `A ${row.status} booking is resolved through its dispute route, not by cancellation`
          : `A ${row.status} booking cannot be cancelled`,
        { status: row.status },
      );
    }

    // The same policy the customer's own cancel runs — one definition of the
    // tiers (§3.5), read from the live `charge_config` like the customer path.
    const { charges } = await this.rateCards.load();
    const outcome = cancellationPolicy({
      status: row.status,
      confirmedAt: row.createdAt,
      basePaise: rupeeStringToPaise(row.baseFare),
      hasDriver: row.driverId !== null,
      config: {
        freeWindowMs: charges.cancelFreeMinutes * 60_000,
        partialWindowMs: charges.cancelPartialMinutes * 60_000,
        partialFeePaise: charges.cancelPartialFeePaise,
        driverCompensationPct: charges.cancelDriverCompPct,
      },
    });

    // G4: waive by default. `apply_policy` records the policy's numbers;
    // `compensateDriver` posts the driver's share even under a waiver.
    const feePaise = body.feeMode === 'apply_policy' ? outcome.feePaise : 0;
    const compensationPaise =
      body.feeMode === 'apply_policy' || body.compensateDriver
        ? outcome.driverCompensationPaise
        : 0;
    // Truthful: "released" reports a coupon actually existed AND was returned.
    // A cancelled book with no coupon answers false, not a technicality.
    const couponReleased = feePaise === 0 && row.couponId !== null;

    const result = await this.db.transaction(async (tx) => {
      // A free cancellation returns the coupon; a fee-bearing one keeps it
      // burnt — the same asymmetry as the customer path.
      if (couponReleased) await this.coupons.releaseForBooking(tx, bookingId);

      return this.machine.transition(tx, {
        bookingId,
        to: 'cancelled',
        actor: 'admin',
        actorId: adminId,
        note: body.reason,
        patch: {
          cancelledBy: 'admin',
          cancellationReason: body.reason,
          cancellationFee: paiseToRupeeString(feePaise),
          driverCompensation: paiseToRupeeString(compensationPaise),
        },
      });
    });

    // §3.5's compensation, an `adjustment` — never an earning type. See
    // `ledgerKeys.cancellationCompensation` for what an earning leg here would
    // do to the earnings projection.
    if (row.driverId && compensationPaise > 0) {
      await this.ledger.post([
        {
          owner: { ownerType: 'driver', ownerId: row.driverId },
          type: 'adjustment',
          amountPaise: compensationPaise,
          reason: `Cancellation compensation (admin, ${outcome.tier})`,
          refId: bookingId,
          idempotencyKey: ledgerKeys.cancellationCompensation(bookingId),
        },
      ]);
    }

    await this.machine.announce(result);
    await this.otp.forget(bookingId);

    // A12: revoked so a driver holding an offer is told immediately. Enqueued,
    // not called — `DispatchModule` imports `BookingsModule`, so importing it
    // back from a bookings-adjacent service would be a cycle.
    try {
      await this.queue.enqueue(
        'dispatch.revoke',
        { bookingId, reason: 'cancelled', holderDriverId: row.driverId ?? undefined },
        { jobId: `revoke-${bookingId}` },
      );
    } catch (error) {
      this.logger.warn(`revoke enqueue failed for ${bookingId}: ${String(error)}`);
    }

    // A14: the driver is free — a shelved suspension applies via the admin
    // worker, exactly as on the customer's cancel.
    if (row.driverId) {
      try {
        await this.queue.enqueue(
          'admin.apply-suspension',
          { driverId: row.driverId },
          { jobId: `apply-suspension-${bookingId}` },
        );
      } catch (error) {
        this.logger.warn(`suspension-apply enqueue failed for ${bookingId}: ${String(error)}`);
      }
    }

    await this.audit.record({
      adminId,
      action: 'booking.cancel',
      subjectType: 'booking',
      subjectId: bookingId,
      before: { status: row.status },
      after: {
        status: 'cancelled',
        feePaise,
        driverCompensationPaise: compensationPaise,
        couponReleased,
      },
      reason: body.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `event=admin_booking_cancelled booking=${bookingId} admin=${adminId} ` +
        `fee_paise=${feePaise} comp_paise=${compensationPaise}`,
    );

    return {
      bookingId,
      status: 'cancelled',
      feePaise,
      driverCompensationPaise: compensationPaise,
      couponReleased,
    };
  }

  /**
   * §6.5's reassign, the six steps in order. See the class doc.
   *
   * Order matters at step 2: `DispatchService.redispatch` early-returns unless
   * the booking is already `searching` — it resumes a search, it does not
   * start one — so the transition has to commit before the re-dispatch is
   * asked for.
   */
  async reassign(
    adminId: string,
    bookingId: string,
    body: AdminBookingReassignBody,
    context: SessionContext,
  ): Promise<AdminBookingReassignResponse> {
    const row = await this.repo.actionRow(bookingId);
    if (!row) throw ApiException.notFound('Booking not found');

    if (!AdminBookingsService.REASSIGNABLE.includes(row.status) || !row.driverId) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        `Only a booking with an assigned driver can be reassigned (this one is ${row.status})`,
        { status: row.status },
      );
    }
    const previousDriverId = row.driverId;

    // 1. A12 — revoke every live offer, and tell the holder their job moved.
    await this.offers.revokeAll(bookingId, 'reassigned');
    this.offers.notifyHolderRevoked(previousDriverId, bookingId, 'reassigned');

    // 2. Back to `searching` with the same patch the driver's own `unable`
    //    path uses — the fields describing a driver en route to a pickup all
    //    stop being true the moment the assignment ends.
    const result = await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId,
        to: 'searching',
        actor: 'admin',
        actorId: adminId,
        note: body.reason,
        patch: {
          driverId: null,
          fleetId: null,
          truckId: null,
          arrivedAt: null,
          routePolyline: null,
          routeDropPolyline: null,
          routeSource: null,
          etaSeconds: null,
          etaUpdatedAt: null,
        },
      }),
    );

    // 3. The attempt row. `unable` when the driver was at fault (it feeds
    //    their completion rate, recomputed from the booking row); `reassigned`
    //    when an operator moved the job and nobody should be penalised.
    const attemptOutcome = body.driverFault ? 'unable' : 'reassigned';
    if (body.driverFault) {
      await this.dispatchRepo.recordUnable(bookingId, previousDriverId);
    } else {
      await this.dispatchRepo.recordReassigned(bookingId, previousDriverId);
    }

    // 4. The cleanup `afterJobEnded` does for a finished job, for a job that
    //    ended early: the driver may go back online at once, nobody should be
    //    routed to a pickup that moved, and the OTP belonged to the old
    //    assignment.
    this.assignments.invalidate(previousDriverId);
    await this.eta.forget(bookingId);
    await this.otp.forget(bookingId);

    // 5/6. Resume the search — at the stored wave, previous driver excluded by
    //      their own attempt rows — or send one exclusive offer first.
    let offeredDriverId: string | null = null;
    if (body.mode === 'offer_to_driver') {
      const outcome = await this.dispatch.adminOfferToDriver(bookingId, body.driverId!);
      if (!outcome.offered) {
        throw ApiException.validation(
          `The chosen driver cannot take this offer (${outcome.exclusion ?? 'unknown'})`,
          { exclusion: outcome.exclusion ?? 'unknown' },
        );
      }
      offeredDriverId = body.driverId!;
    } else {
      await this.dispatch.redispatch(bookingId, 'admin_reassign');
    }

    await this.machine.announce(result);

    await this.audit.record({
      adminId,
      action: 'booking.reassign',
      subjectType: 'booking',
      subjectId: bookingId,
      before: { status: row.status, driverId: previousDriverId },
      after: { status: 'searching', mode: body.mode, attemptOutcome, offeredDriverId },
      reason: body.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    this.logger.log(
      `event=admin_booking_reassigned booking=${bookingId} admin=${adminId} ` +
        `mode=${body.mode} outcome=${attemptOutcome}`,
    );

    return {
      bookingId,
      status: 'searching',
      mode: body.mode,
      attemptOutcome,
      previousDriverId,
      offeredDriverId,
    };
  }

  /**
   * §9.4.7's manual status override — super admin only, money-free edges only.
   *
   * The edge is validated against the CONTRACT's allowlist and the current
   * status, so the service cannot drift from the list the console renders.
   * `in_progress → completed` is the one edge with money behind it and it goes
   * through the real completion service.
   *
   * Named for the console's action (`booking.override`), not `transition`, so
   * the A18 announce guard's source-text rule reads the controller for what it
   * is — an HTTP hop to this service — rather than as a second transition site.
   */
  async transitionOverride(
    adminId: string,
    bookingId: string,
    body: AdminBookingTransitionBody,
    context: SessionContext,
  ): Promise<AdminBookingTransitionResponse> {
    const row = await this.repo.actionRow(bookingId);
    if (!row) throw ApiException.notFound('Booking not found');

    const allowed = ADMIN_TRANSITION_EDGES.filter((edge) => edge.from === row.status).map(
      (edge) => edge.to,
    );
    if (!allowed.includes(body.to as (typeof allowed)[number])) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        `A ${row.status} booking cannot be moved to ${body.to} by an operator`,
        { from: row.status, to: body.to, allowed },
      );
    }

    if (body.to === 'completed') {
      // §7.4's waiting charge must come from the booking's snapshot — one
      // implementation of that arithmetic, shared with the driver's Complete.
      await this.jobs.completeByAdmin(bookingId, adminId, body.reason);
      await this.audit.record({
        adminId,
        action: 'booking.transition.override',
        subjectType: 'booking',
        subjectId: bookingId,
        before: { status: row.status },
        after: { status: 'completed' },
        reason: body.reason,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
      return { bookingId, from: row.status, to: 'completed' };
    }

    const now = new Date();
    const result = await this.db.transaction((tx) =>
      this.machine.transition(tx, {
        bookingId,
        to: body.to,
        actor: 'admin',
        actorId: adminId,
        note: body.reason,
        patch:
          body.to === 'arrived'
            ? { arrivedAt: now }
            : body.to === 'in_progress'
              ? { startedAt: now }
              : {},
      }),
    );
    await this.machine.announce(result);

    await this.audit.record({
      adminId,
      action: 'booking.transition.override',
      subjectType: 'booking',
      subjectId: bookingId,
      before: { status: row.status },
      after: { status: body.to },
      reason: body.reason,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { bookingId, from: row.status, to: body.to };
  }

  /** §14.2's recheck — the sweep's single-booking path, now. */
  async recheck(bookingId: string): Promise<AdminBookingRecheckResponse> {
    const row = await this.repo.actionRow(bookingId);
    if (!row) throw ApiException.notFound('Booking not found');

    const result = await this.payments.recheckBooking(bookingId);
    return {
      bookingId,
      bookingStatus: row.status,
      paymentStatus: result.paymentStatus,
      settled: result.settled,
    };
  }

  /**
   * §14.2's reminder. One per booking per IST day: a double-tapped button is
   * collapsed by the trigger's dedupe key, and a deliberate nudge tomorrow is
   * a new day — which is why the key is `bookingId:istDay` and not just the
   * booking id.
   */
  async remind(bookingId: string): Promise<AdminBookingRemindResponse> {
    const row = await this.repo.actionRow(bookingId);
    if (!row) throw ApiException.notFound('Booking not found');

    if (row.status !== 'completed') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCodes.INVALID_BOOKING_STATE,
        'Only a completed, unpaid booking can be reminded',
        { status: row.status },
      );
    }

    const day = istDayStart().toISOString();
    const emitted = await this.notifications.emit('payment.reminder', {
      bookingId,
      userId: row.userId,
      amountPaise: rupeeStringToPaise(row.total),
      reminderKey: `${bookingId}:${day}`,
    });
    // `emit` answers null when the dedupe collapsed a replay — which is
    // exactly the "already reminded today" the response reports.
    return { bookingId, sent: emitted !== null };
  }
}

/** §9.4.7's export columns — money in rupees, matching every other CSV this API emits. */
const BOOKING_CSV_HEADER = [
  'code',
  'created_at',
  'status',
  'service_type',
  'vehicle_class',
  'customer',
  'customer_mobile',
  'driver',
  'fleet',
  'zone',
  'pickup',
  'drop',
  'distance_km',
  'total_inr',
  'commission_inr',
  'driver_payout_inr',
  'band',
  'commission_pct',
  'scheduled_at',
  'updated_at',
];

function toCsvCells(booking: AdminBookingSummary): string[] {
  return [
    booking.code,
    booking.createdAt,
    booking.status,
    booking.serviceType,
    booking.vehicleClass,
    booking.userName ?? '',
    booking.userMobile,
    booking.driverName ?? '',
    booking.fleetName ?? '',
    booking.zoneName ?? '',
    booking.pickupAddress ?? '',
    booking.dropAddress ?? '',
    booking.distanceKm === null ? '' : String(booking.distanceKm),
    paiseToRupeeString(booking.totalPaise),
    paiseToRupeeString(booking.commissionPaise),
    paiseToRupeeString(booking.driverPayoutPaise),
    booking.commissionBand ?? '',
    booking.commissionPct === null ? '' : String(booking.commissionPct),
    booking.scheduledAt ?? '',
    booking.updatedAt,
  ];
}
