import { z } from 'zod';

/** Standard error envelope for every API error response (spec §16). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** Stable machine-readable error codes shared by backend and clients. */
export const ErrorCodes = {
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  CONFLICT: 'conflict',
  IDEMPOTENCY_REPLAY_MISMATCH: 'idempotency_replay_mismatch',
  TRUCK_ALREADY_ASSIGNED: 'truck_already_assigned',
  DUPLICATE_PLATE: 'duplicate_plate',
  DUPLICATE_MOBILE: 'duplicate_mobile',
  /** Realtime is switched off (REALTIME_ENABLED=false) — clients fall back to REST polling (§19.2). */
  REALTIME_UNAVAILABLE: 'realtime_unavailable',

  // --- Money & settings (Phase 7) -----------------------------------------
  /**
   * §9.3.1: "account usable only after business profile completes". Scoped to
   * the money paths — requesting a payout or linking a bank account. `details`
   * carries `{ onboardingStep, missing }` so the console can deep-link the
   * wizard to the step that is actually blocking.
   */
  PROFILE_INCOMPLETE: 'profile_incomplete',
  /** No `active` payout_accounts row — the payout has no destination (§14.4). */
  PAYOUT_ACCOUNT_NOT_LINKED: 'payout_account_not_linked',
  /** Below `PAYOUT_MIN_PAISE` (§14.4 "min threshold"). `details.minPaise`. */
  PAYOUT_BELOW_MINIMUM: 'payout_below_minimum',
  /** Above `PAYOUT_MAX_PAISE` — a units-bug guard, not a product rule. */
  PAYOUT_ABOVE_MAXIMUM: 'payout_above_maximum',
  /** One open payout per owner (`uq_payouts_one_open_per_owner`). */
  PAYOUT_ALREADY_PENDING: 'payout_already_pending',
  /** Wallet balance is less than the requested amount. `details.availablePaise`. */
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  /** Webhook HMAC did not verify (§19.3) — returned before any DB write. */
  INVALID_SIGNATURE: 'invalid_signature',

  // --- Notifications (Phase 13) -------------------------------------------
  /**
   * A push token is already held by a live `devices` row belonging to a
   * different subject and could not be reassigned. Surfaced rather than
   * swallowed because it means two accounts are contending for one handset —
   * the shared-driver-phone case — and the client should re-mint its token.
   */
  DEVICE_TOKEN_CONFLICT: 'device_token_conflict',

  // --- Booking lifecycle (Phase 15) ---------------------------------------
  /**
   * §3.7: the customer's `users.status` is not `active`. Distinct from
   * `FORBIDDEN` because the client's remedy is different — a suspended account
   * needs support, not a re-login.
   */
  ACCOUNT_NOT_ACTIVE: 'account_not_active',
  /**
   * §3.8 "one active booking per customer at a time (configurable)". Backed by
   * `uq_bookings_one_active_per_user`, so this is also what a lost concurrent
   * race returns. `details.bookingId` is the trip already in flight, which is
   * what lets TowGo offer "view your current trip" instead of a dead end.
   */
  ACTIVE_BOOKING_EXISTS: 'active_booking_exists',
  /** §3.8 "blocked from new bookings until cleared". `details.bookingId`. */
  UNPAID_BALANCE: 'unpaid_balance',
  /**
   * The booking is in a state §5.1 does not allow this transition from — an
   * illegal move through `BookingStateMachine`, or a cancel of something
   * already terminal.
   */
  INVALID_BOOKING_STATE: 'invalid_booking_state',
  /**
   * §3.5's chargeable cancellation tiers. The fee is computed and returned in
   * `details`, but taking it needs the ledger, which is Phase 19.
   */
  CANCELLATION_NOT_FREE: 'cancellation_not_free',
  /** §9.1.7: "OTP never visible before assignment". */
  OTP_NOT_AVAILABLE: 'otp_not_available',
  /** §6.10: the pickup falls outside every active service zone. */
  OUTSIDE_SERVICE_AREA: 'outside_service_area',
  /** §7.3: over 600 km is a manual quote, not an automatic fare. */
  MANUAL_QUOTE_REQUIRED: 'manual_quote_required',

  // --- Driver presence & location (Phase 16) ------------------------------
  /**
   * §6.1 keys the candidate store by zone, so a driver whose current fix falls
   * outside every active `service_zones` polygon cannot go online: they would
   * be online in the UI and in no GEO set, i.e. invisible to dispatch. Distinct
   * from `OUTSIDE_SERVICE_AREA`, which is the customer-side pickup refusal —
   * the remedy here is "drive into a covered area", not "book elsewhere".
   */
  DRIVER_OUTSIDE_ZONE: 'driver_outside_zone',
  /**
   * Location was posted by a driver who is not online. Not silently accepted:
   * §20.4 says capture happens only while online or on a job, so a stream
   * arriving from an offline handset is a client bug worth surfacing rather
   * than a stream worth storing.
   */
  DRIVER_NOT_ONLINE: 'driver_not_online',
  /**
   * Address search is configured against Google but has no key, or the local
   * gazetteer was asked for something outside the areas it knows. Separate from
   * a 404 because the remedy is "pick from the map", not "try another spelling".
   */
  PLACES_UNAVAILABLE: 'places_unavailable',

  // --- Dispatch (Phase 17) -------------------------------------------------
  /**
   * The offer is gone. §6.3's twenty-second window closed, another driver
   * accepted first, or the customer cancelled mid-search.
   *
   * SEPARATE FROM `CONFLICT` BECAUSE IT IS NOT AN ERROR THE DRIVER MADE. Two
   * drivers racing one booking is the system working — exactly one wins, and the
   * loser must be told "someone got there first", not shown a failure. The
   * client uses this to dismiss its takeover screen quietly.
   */
  OFFER_NO_LONGER_AVAILABLE: 'offer_no_longer_available',
  /**
   * The driver was offered this job but is no longer eligible for it by the time
   * they accepted — they went offline, an admin suspended them, or their truck
   * fell out of compliance inside the window. §3.1's database layer, enforced at
   * the last possible moment rather than trusted from the offer.
   */
  DRIVER_NOT_ELIGIBLE: 'driver_not_eligible',
  /**
   * §19.8: dispatch is paused for this zone, or long-distance offers are off.
   * An operator did this on purpose; the customer is told the wait is longer
   * rather than that something broke.
   */
  DISPATCH_PAUSED: 'dispatch_paused',

  // --- Job execution (Phase 18) -------------------------------------------
  /**
   * §9.2.3's "job cannot start without a valid OTP" — the driver typed six
   * digits and they were not the ones the customer is holding.
   *
   * ONE CODE FOR FOUR DIFFERENT FAILURES, deliberately: wrong code, expired
   * window, attempt cap exhausted, and no code ever minted all return this.
   * `BookingOtpService.verify` was written to be indistinguishable across those
   * cases for the same reason `login_challenges` is — anything finer is an
   * oracle against a six-digit space, and the space is small enough to matter.
   *
   * `details.attemptsRemaining` is safe to send and is the one thing the driver
   * actually needs, because the alternative to knowing is finding out by being
   * locked out mid-handover.
   */
  INVALID_BOOKING_OTP: 'invalid_booking_otp',
  /**
   * The driver has no active job, or is not the driver on the booking they are
   * trying to move. Distinct from `FORBIDDEN`: the common cause is not an attack
   * but a stale screen — a job that was completed on another device, or a
   * re-dispatch that already took it away.
   */
  NOT_ASSIGNED_DRIVER: 'not_assigned_driver',
  /**
   * §11.7's link is dead: revoked from the tracking screen, or past the
   * completion + 30 min grace.
   *
   * NOT A 404, and the distinction is the point. A 404 says "no such trip",
   * which invites the recipient to think they mistyped; this says the link
   * worked and has ended, which is the true and less alarming answer for
   * somebody who was sent it precisely because they were worried.
   */
  SHARE_LINK_EXPIRED: 'share_link_expired',

  /**
   * The gateway does not report this payment as captured. Deliberately NOT an
   * error about the customer: §19.2's ladder says a booking legitimately sits
   * at COMPLETED (unpaid) when Razorpay is slow or down, and the 5-minute sweep
   * resolves it. The app should say "we are confirming your payment", not
   * "your payment failed".
   */
  PAYMENT_NOT_CAPTURED: 'payment_not_captured',
  /**
   * The captured amount is not the booking's total.
   *
   * A REAL ATTACK, not a rounding guard: create a ₹1 order out of band and
   * present it against a ₹2,000 tow. Without this check the ledger credits a
   * driver from money that was never collected, and every invariant stays
   * green because they all reconcile against `bookings.total`.
   */
  PAYMENT_AMOUNT_MISMATCH: 'payment_amount_mismatch',
  /** The checkout signature does not verify against the merchant secret. */
  INVALID_PAYMENT_SIGNATURE: 'invalid_payment_signature',
  /**
   * §3.5's chargeable tiers need the fee collected before the trip is
   * cancelled — otherwise the platform cancels and then chases the customer.
   * The app must run the payment sheet and retry with the result.
   */
  CANCELLATION_REQUIRES_PAYMENT: 'cancellation_requires_payment',
  /**
   * The coupon ran out between validate and confirm. The whole confirm
   * transaction rolls back — fare lock, OTP, booking row and redemption
   * together — so there is no orphan booking carrying a discount nobody
   * recorded.
   */
  COUPON_EXHAUSTED: 'coupon_exhausted',
  /** The coupon is not applicable; `details.reason` says why. */
  COUPON_INVALID: 'coupon_invalid',
  /** Approve/reject on a payout that some other admin already decided. */
  PAYOUT_ALREADY_DECIDED: 'payout_already_decided',
  /** The booking has no invoice yet — it has not been paid. */
  INVOICE_NOT_READY: 'invoice_not_ready',
  /** Rating a booking that has not finished, or that is not the caller's. */
  RATING_NOT_ALLOWED: 'rating_not_allowed',

  INTERNAL: 'internal_error',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
