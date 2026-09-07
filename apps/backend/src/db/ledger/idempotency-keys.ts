/**
 * Every `wallet_transactions.idempotency_key` this application writes, built
 * here so a raw string literal never appears at a call site.
 *
 * Grammar: `<source>:<version>:<entity>:<id>[:<leg>]` — the same four-segment
 * shape the seed already uses (`seed:v1:bk:<i>:driver`). The first segment is
 * the SOURCE: `seed` for seeded data, `bk`/`po`/`adj` for live data. `seed` is
 * never an entity name and `bk` is never a source, so a collision between
 * seeded and live keys is structurally impossible rather than merely unlikely.
 *
 * **The key is derived from the domain id — never from the client's
 * `Idempotency-Key` header, and never from a fresh UUID.** A retried settlement
 * job computes the same key from the same booking id, so the second attempt is
 * a no-op *even if Redis lost the interceptor's marker*. The header protects
 * the HTTP response; this protects the money. That split is exactly what
 * `IdempotencyInterceptor`'s own docstring promises ("the unique constraints on
 * payments/payouts/wallet idempotency_key are the real backstop; this is the
 * fast path").
 *
 * Bump the version segment — never reuse it with different semantics — if the
 * meaning of a leg ever changes.
 */
export const ledgerKeys = {
  /** §14.3 fleet-driver split: the driver's share of the pool. */
  bookingDriverShare: (bookingId: string) => `bk:v1:${bookingId}:driver`,
  /** §14.3 fleet-driver split: the fleet's share of the pool. */
  bookingFleetShare: (bookingId: string) => `bk:v1:${bookingId}:fleet`,
  /** Independent driver: the whole pool as one credit. */
  bookingNetFare: (bookingId: string) => `bk:v1:${bookingId}:net`,
  /** The hold written when a payout is requested (§14.4). */
  payoutDebit: (payoutId: string) => `po:v1:${payoutId}:debit`,
  /** The compensating credit when that payout fails (§14.5: never an edit). */
  payoutReversal: (payoutId: string) => `po:v1:${payoutId}:reversal`,
  /** Manual correction, keyed by whatever record authorises it. */
  adjustment: (adjustmentId: string) => `adj:v1:${adjustmentId}`,

  /**
   * §3.5's driver compensation when a customer cancels chargeably.
   *
   * Its leg type is `adjustment`, NEVER `fare_credit` or `driver_share_credit`,
   * and that is the single most consequential type choice in Phase 19. The
   * earnings projector joins the three settlement credit types to `bookings` by
   * `ref_id` WITH NO STATUS FILTER, so an earning leg on a cancelled booking
   * would make it count `gross = booking.total` — the full fare of a trip that
   * never happened — inflating `earnings_daily`, every fleet report and the
   * §9.4.13 GMV chart. And it would trip NO invariant: `ledgerDrift` filters
   * `status = 'paid'`, while `projectionDrift` compares the projection against
   * the same wrong query, so the two would agree perfectly on a wrong number.
   */
  cancellationCompensation: (bookingId: string) => `cx:v1:${bookingId}:driver`,

  /**
   * §14.5 reversal legs. REFUND-scoped, not booking-scoped, because one
   * booking can carry a cancellation refund and later a dispute refund — and
   * `bk:v1:<bookingId>:driver` is already taken by the original settlement.
   *
   * (The `refunds.idempotency_key` ROW key is the booking-scoped
   * `rf:v1:<bookingId>:<reason>`: there is at most one refund per booking per
   * reason. Two different scopes, deliberately, for two different uniqueness
   * questions.)
   */
  refundDriverDebit: (refundId: string) => `rf:v1:${refundId}:driver`,
  refundFleetDebit: (refundId: string) => `rf:v1:${refundId}:fleet`,
} as const;

/**
 * `refunds.idempotency_key`. Not a ledger key — it dedupes the refund ROW, the
 * way `po:v1:req:…` dedupes a payout request — but it lives here so the whole
 * grammar is legible in one file.
 */
export const refundRowKey = (bookingId: string, reason: RefundReason): string =>
  `rf:v1:${bookingId}:${reason}`;

/** The reasons a refund can exist. Part of the key, so the list is closed. */
export const REFUND_REASONS = ['cancellation', 'dispute', 'duplicate_payment'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/**
 * `payments.idempotency_key`. Namespaced by booking AND purpose because
 * `uq_payments_idempotency_key` is GLOBAL: two customers both sending
 * `Idempotency-Key: 1` would otherwise collide and the second would silently
 * receive the first's payment. Exactly the trap `PayoutsService` already
 * guards with `po:v1:req:<fleetId>:<sha256>`.
 */
export const paymentRowKey = (bookingId: string, purpose: string, hashedClientKey: string): string =>
  `pay:v1:${bookingId}:${purpose}:${hashedClientKey}`;

/**
 * `payouts.idempotency_key`. **v2**, because Phase 19 widened payouts from
 * fleet-only to `(ownerType, ownerId)` and a fleet id and a driver id are both
 * bare UUIDs — `po:v1:req:<fleetId>:…` and a hypothetical
 * `po:v1:req:<driverId>:…` are indistinguishable. Per this file's own rule
 * ("bump the version segment — never reuse it with different semantics"), the
 * shape changed, so the version did.
 */
export const payoutRowKey = (
  ownerType: string,
  ownerId: string,
  hashedClientKey: string,
): string => `po:v2:req:${ownerType}:${ownerId}:${hashedClientKey}`;

export type LedgerKeyBuilder = keyof typeof ledgerKeys;
