import { pgEnum } from 'drizzle-orm/pg-core';

// Spec §3.2 — roadside services are open to both truck classes; tows are not.
export const serviceTypeEnum = pgEnum('service_type', [
  'tow',
  'battery',
  'flat_tyre',
  'fuel',
  'breakdown',
  'accident_recovery',
  'lockout',
  'winch_out',
]);

export const vehicleClassEnum = pgEnum('vehicle_class', ['wheel_lift', 'flatbed']);

// Spec §3.3 — A: local ≤40km @10%, B: highway 40–100km @8%, C: long-haul >100km @5%.
export const commissionBandEnum = pgEnum('commission_band', ['A', 'B', 'C']);

/**
 * §7.4 surge tiers. Phase 14 replaced the free-text `service_zones.surge_band`
 * with this: the column was nullable `text`, only ever held the literal
 * 'standard', and nothing read it. The estimate multiplies by the band, so a
 * typo in free text is a silently un-surged fare.
 */
export const surgeBandEnum = pgEnum('surge_band', ['standard', 'high', 'peak']);

/**
 * Discriminator on `pricing_rules`. `slab` is a §7.1/§7.2 distance band,
 * `long_distance` a §7.3 range (price..price_max, interpolated), `roadside` a
 * flat per-service fare. A CHECK in migration 0011 enforces which columns each
 * kind may populate.
 */
export const pricingRuleKindEnum = pgEnum('pricing_rule_kind', [
  'slab',
  'long_distance',
  'roadside',
]);

export const accountStatusEnum = pgEnum('account_status', ['active', 'suspended', 'deleted']);

// Spec §17 drivers.kyc_status
export const kycStatusEnum = pgEnum('kyc_status', [
  'pending',
  'approved',
  'rejected',
  'incomplete',
  'suspended',
]);

export const driverLevelEnum = pgEnum('driver_level', ['bronze', 'silver', 'gold', 'platinum']);

export const driverDocTypeEnum = pgEnum('driver_doc_type', [
  'license',
  'rc',
  'gov_id',
  'inspection',
  'selfie',
]);

export const docReviewStatusEnum = pgEnum('doc_review_status', [
  'pending',
  'approved',
  'rejected',
]);

export const fleetStatusEnum = pgEnum('fleet_status', ['pending', 'active', 'suspended']);

// `non_compliant` is the dispatch-exclusion seam (§3.2 zone check).
export const truckStatusEnum = pgEnum('truck_status', ['active', 'inactive', 'non_compliant']);

export const complianceDocTypeEnum = pgEnum('compliance_doc_type', [
  'insurance',
  'rc',
  'puc',
  'permit',
]);

export const complianceStatusEnum = pgEnum('compliance_status', [
  'valid',
  'expiring_soon',
  'expired',
]);

// Stored fleet alerts (§9.3.2). Mirrors `fleetAlertSchema.type` in the
// contracts — `truck_idle` was reserved there from Phase 4 and is still unused.
export const alertTypeEnum = pgEnum('alert_type', [
  'doc_expiring',
  'doc_expired',
  'truck_idle',
  'payout_failed',
]);

export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'warning', 'error']);

/** What an alert is about — half of the dedup key that makes re-runs idempotent. */
export const alertSubjectTypeEnum = pgEnum('alert_subject_type', [
  'compliance_document',
  'truck',
  'payout',
]);

export const importStatusEnum = pgEnum('import_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

// Spec §5.1 customer booking state machine.
export const bookingStatusEnum = pgEnum('booking_status', [
  'searching',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'paid',
  'cancelled',
  'no_drivers_found',
  'disputed',
  /** Settled, then given back. `disputed` stays for a trip somebody contests. */
  'refunded',
]);

export const actorRoleEnum = pgEnum('actor_role', [
  'customer',
  'driver',
  'fleet_owner',
  'admin',
  'system',
]);

export const walletOwnerTypeEnum = pgEnum('wallet_owner_type', ['user', 'driver', 'fleet']);

/**
 * Ledger entry kinds (§3.4). `credit`/`debit` sign is carried by `amount`.
 *
 * `commission_debit` is RESERVED AND NEVER WRITTEN. The platform has no wallet,
 * so commission has no counterparty leg: `LedgerService` credits the
 * post-commission pool and the commission lives as `bookings.commission_amount`
 * plus the pool's absence. Writing one would mean crediting gross and then
 * debiting, which breaks the third seed invariant (credited legs must sum to
 * `bookings.driver_payout`) and diverges from the transaction shape 755 seeded
 * rows already carry. Removing it from the enum is a migration for no gain —
 * leaving it documented is cheaper than someone rediscovering why.
 */
export const walletTxnTypeEnum = pgEnum('wallet_txn_type', [
  'fare_credit',
  'commission_debit',
  'fleet_share_credit',
  'driver_share_credit',
  'payout_debit',
  'refund_debit',
  'refund_credit',
  'adjustment',
  /** Migration 0035: a cash trip debits the driver the fare they collected (see payments). */
  'cash_collected_debit',
  /** Migration 0035: the customer's wallet balance spent on a booking at payment. */
  'wallet_spend_debit',
]);

/**
 * Route linked-account lifecycle (§14.4). `unlinked` is the resting state of a
 * fleet that has never onboarded — a row exists so the wizard has somewhere to
 * record progress, and `active` is the only state `POST /fleet/payouts` accepts.
 */
export const payoutAccountStatusEnum = pgEnum('payout_account_status', [
  'unlinked',
  'pending',
  'active',
  'rejected',
  'suspended',
]);

/**
 * §9.3.1's resumable first-login wizard. A MONOTONIC HIGH-WATER MARK, not "the
 * step currently shown": the server advances it by one as each stage completes
 * and never moves it back, so an owner editing their address from /settings two
 * years later is not thrown into the wizard again.
 */
export const fleetOnboardingStepEnum = pgEnum('fleet_onboarding_step', [
  'profile',
  'payout_account',
  'notifications',
  'done',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'authorized',
  'captured',
  'failed',
  'refunded',
]);

export const paymentMethodEnum = pgEnum('payment_method', ['upi', 'card', 'cash', 'wallet']);

export const payoutStatusEnum = pgEnum('payout_status', [
  'requested',
  'processing',
  'paid',
  'failed',
]);

export const refundStatusEnum = pgEnum('refund_status', ['pending', 'processed', 'failed']);

export const otpPurposeEnum = pgEnum('otp_purpose', [
  'fleet_login',
  'driver_login',
  'customer_login',
  'booking_start',
  'admin_login',
]);

/**
 * Admin RBAC (§4.2, §9.4). Enforced server-side on every admin route via
 * `@Roles()`; the sub-role also rides in the admin access token as `sub_role`.
 *
 * Deliberately its own enum rather than a reuse of `actorRoleEnum`: that one
 * answers "who acted" on a booking and already contains `system`, which can
 * never hold a session.
 */
export const adminSubRoleEnum = pgEnum('admin_sub_role', [
  'super_admin',
  'operations',
  'support',
  'finance',
]);

/**
 * Social sign-in providers (§9.1). `apple` exists from the start so enabling it
 * in Phase 13 is a flag, not a migration — but the Apple adapter ships disabled
 * until an Apple Developer enrolment exists to test it against.
 */
export const socialProviderEnum = pgEnum('social_provider', ['google', 'apple']);
