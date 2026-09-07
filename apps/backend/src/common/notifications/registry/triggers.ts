import type { DeferredTrigger, Recipient, RegisteredTrigger } from './trigger.types';

/**
 * THE §12.2 REGISTRY — the durable half of Phase 13.
 *
 * Every notification the product sends is declared here as
 * *event → channels → template → recipient resolver → category*, and every
 * §12.2 row that is NOT yet implemented is declared in `DEFERRED_TRIGGERS` with
 * the phase that owns it. `registry.spec.ts` fails on any matrix row that
 * appears in neither list.
 *
 * That test is the mechanism, and the mechanism is the point: Phase 15 wires
 * *booking confirmed* in the same commit that creates a booking, Phase 17 wires
 * *driver assigned* and *search widening*, 18 wires *en route*, *arrived* and
 * *job started*, 19 wires the money rows, 20 wires SOS and *dispute update* —
 * because otherwise their own suite goes red. "We forgot to notify the
 * customer" stops being a thing a customer discovers.
 *
 * To add a row later: delete its `DEFERRED_TRIGGERS` entry, add a
 * `RegisteredTrigger` claiming the same `matrixRow`, and emit it. Nothing else.
 */

// ---------------------------------------------------------------------------
// Payload shapes — domain ids only. NEVER an address, never a credential.
// ---------------------------------------------------------------------------

export interface KycDecisionPayload extends Record<string, unknown> {
  driverId: string;
  driverName: string | null;
  reason: string | null;
  /** The `admin_actions` row id for this decision — see the dedupe note below. */
  auditId: string;
}

export interface ComplianceExpiringPayload extends Record<string, unknown> {
  fleetId: string;
  docType: string;
  plate: string | null;
  daysLeft: number;
}

/** §12.2's four Phase 19 rows. Domain ids and PRE-FORMATTED money only. */
export interface PaymentStatusPayload extends Record<string, unknown> {
  bookingId: string;
  userId: string;
  paymentId: string;
  /** Already formatted — templates never do money arithmetic. */
  amount: string;
  reason?: string;
}

export interface CompletedInvoicePayload extends Record<string, unknown> {
  bookingId: string;
  userId: string;
  amount: string;
}

export interface EarningsCreditedPayload extends Record<string, unknown> {
  bookingId: string;
  driverId: string;
  amount: string;
}

export interface WeeklyEarningsPayload extends Record<string, unknown> {
  driverId: string;
  amount: string;
  jobs: string;
  weekLabel: string;
}

export interface PayoutStatusPayload extends Record<string, unknown> {
  payoutId: string;
  /**
   * THREE values, matching `wallet_owner_type` exactly. Narrowing this to
   * `'fleet' | 'driver'` is how a customer-wallet payout notifies nobody.
   */
  ownerType: 'user' | 'driver' | 'fleet';
  ownerId: string;
  amount: string;
  reference: string | null;
  reason: string | null;
}

export interface DriverInvitePayload extends Record<string, unknown> {
  driverId: string;
  businessName: string;
}

export interface BookingConfirmedPayload extends Record<string, unknown> {
  bookingId: string;
  userId: string;
  /** Display code, e.g. `TW-3F9A21B4`. Same one the fleet console shows. */
  reference: string;
  serviceName: string;
  /** Already formatted for a human — templates never do money arithmetic. */
  amount: string;
}

export interface JobOfferedPayload extends Record<string, unknown> {
  bookingId: string;
  driverId: string;
  /** Already formatted — templates never do money arithmetic. The NET, not the gross. */
  netAmount: string;
  pickupAddress: string;
  /** Absolute, on the server clock. Carried so a client can render a live countdown. */
  expiresAt: string;
}

export interface DriverAssignedPayload extends Record<string, unknown> {
  bookingId: string;
  userId: string;
  driverId: string;
  driverName: string | null;
  reference: string;
}

export interface SearchWideningPayload extends Record<string, unknown> {
  bookingId: string;
  userId: string;
  radiusKm: number;
  driversContacted: number;
}

export interface NoDriversFoundPayload extends Record<string, unknown> {
  bookingId: string;
  userId: string;
  reference: string;
}

export interface OpsLedgerDriftPayload extends Record<string, unknown> {
  day: string;
  driftPaise: number;
  opsEmail: string;
}

// ---------------------------------------------------------------------------
// Registered
// ---------------------------------------------------------------------------

const one = (recipient: Recipient | null): Recipient[] => (recipient ? [recipient] : []);

/**
 * Type-checks each trigger against its OWN payload at the definition site, then
 * erases the parameter so they can live in one array. Without it the array
 * would have to be typed `RegisteredTrigger<any>`, and a resolver reading a
 * field its payload does not have would compile.
 */
function defineTrigger<P extends Record<string, unknown>>(
  trigger: RegisteredTrigger<P>,
): RegisteredTrigger<never> {
  return trigger as unknown as RegisteredTrigger<never>;
}

export const REGISTERED_TRIGGERS: RegisteredTrigger<never>[] = [
  defineTrigger({
    event: 'driver.kyc.approved',
    matrixRow: 'kyc_approved',
    channels: ['push', 'sms', 'whatsapp'],
    template: 'driver_kyc_approved',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'kyc', route: 'towpartner://kyc' },
    /**
     * Keyed on the AUDIT ROW ID, not `${driverId}:${decidedAt}`.
     *
     * `AdminDriversService.decide()` computes `new Date()` per call, so two
     * rapid clicks produce two distinct timestamps and a timestamp-based key
     * dedupes nothing at all — while looking like it does. `AdminAuditService`
     * writes exactly one row per decision, so its id is the thing that is
     * genuinely one-per-decision.
     */
    dedupeKey: (p: KycDecisionPayload) => p.auditId,
    resolve: (p: KycDecisionPayload, ctx) => ctx.resolver.resolveDriver(p.driverId).then(one),
    variables: (p: KycDecisionPayload) => ({ name: p.driverName ?? '' }),
  }),

  defineTrigger({
    event: 'booking.confirmed',
    matrixRow: 'booking_confirmed',
    channels: ['push', 'sms', 'whatsapp'],
    template: 'booking_confirmed',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'bookings', route: 'towgo://bookings' },
    /**
     * The booking id. One booking is confirmed exactly once — `POST /v1/bookings`
     * is idempotent and the §5.1 machine has no edge back into `searching`
     * except from `no_drivers_found`, which is a re-search rather than a new
     * confirmation. Nothing weaker (a timestamp) would dedupe a retried emit.
     */
    dedupeKey: (p: BookingConfirmedPayload) => p.bookingId,
    resolve: (p: BookingConfirmedPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: BookingConfirmedPayload) => ({
      reference: p.reference,
      service: p.serviceName,
      amount: p.amount,
    }),
  }),

  defineTrigger({
    event: 'driver.kyc.rejected',
    matrixRow: 'kyc_rejected',
    channels: ['push', 'sms', 'whatsapp'],
    template: 'driver_kyc_rejected',
    category: 'transactional',
    alwaysOn: true,
    /**
     * `refetch`, NOT `reauthenticate`.
     *
     * A rejection DOES revoke the driver's refresh tokens
     * (`admin-drivers.service.ts` — `revokesAuthority` covers `suspended` and
     * `rejected`), but `revokeSubject` only touches `refresh_tokens`, and
     * `JwtAuthGuard` verifies signature and shape with no denylist lookup. The
     * access token therefore keeps working for the rest of its TTL — which is
     * exactly the window the driver needs to read WHY they were rejected. A
     * push that bounced them to the phone-entry screen would deliver a
     * rejection nobody could read.
     */
    push: { action: 'refetch', invalidate: 'kyc', route: 'towpartner://kyc' },
    dedupeKey: (p: KycDecisionPayload) => p.auditId,
    resolve: (p: KycDecisionPayload, ctx) => ctx.resolver.resolveDriver(p.driverId).then(one),
    variables: (p: KycDecisionPayload) => ({
      name: p.driverName ?? '',
      reason: p.reason ?? '',
    }),
  }),

  defineTrigger({
    event: 'driver.kyc.request_info',
    matrixRow: 'kyc_rejected',
    channels: ['push', 'sms', 'whatsapp'],
    template: 'driver_kyc_request_info',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'kyc', route: 'towpartner://kyc' },
    dedupeKey: (p: KycDecisionPayload) => p.auditId,
    resolve: (p: KycDecisionPayload, ctx) => ctx.resolver.resolveDriver(p.driverId).then(one),
    variables: (p: KycDecisionPayload) => ({
      name: p.driverName ?? '',
      reason: p.reason ?? '',
    }),
  }),

  defineTrigger({
    event: 'compliance.doc_expiring',
    matrixRow: 'compliance_doc_expiring',
    // The matrix's fourth cell is ✅ (web), not push — already delivered by the
    // console's /alerts page since Phase 6. A parallel push channel would be a
    // second source of truth for the same fact.
    channels: ['whatsapp', 'email'],
    template: 'fleet_compliance_expiring',
    category: 'compliance',
    alwaysOn: false,
    /**
     * NO DEDUPE KEY, deliberately.
     *
     * `runComplianceSweep` already guarantees once-per-document-per-window via
     * `alert_sent_30d`, and that flag is RESET when the document goes back to
     * valid — which is what lets next year's expiry notify again. A dedupe key
     * of `${docId}:${daysLeft}` against a permanent partial-unique index would
     * silently cancel that reset and the fleet would never be warned again for
     * a renewed document.
     */
    resolve: (p: ComplianceExpiringPayload, ctx) => ctx.resolver.resolveFleet(p.fleetId).then(one),
    variables: (p: ComplianceExpiringPayload) => ({
      docType: p.docType,
      plate: p.plate ?? '',
      daysLeft: String(p.daysLeft),
    }),
  }),

  defineTrigger({
    event: 'payout.processed',
    matrixRow: 'payout_status',
    channels: ['push', 'sms', 'email'],
    template: 'payout_paid',
    category: 'money',
    // NOT always-on: a payout receipt is not a legally unsuppressible message
    // the way an OTP or a safety alert is, and the fleet console has shipped a
    // `payouts` toggle since Phase 7. Leaving this always-on would have left
    // that switch wired to nothing.
    alwaysOn: false,
    push: { action: 'open', route: 'towpartner://earnings' },
    resolve: (p: PayoutStatusPayload, ctx) =>
      ctx.resolver.resolveWalletOwner(p.ownerType, p.ownerId).then(one),
    variables: (p: PayoutStatusPayload) => ({
      amount: p.amount,
      reference: p.reference ?? '',
    }),
  }),

  defineTrigger({
    event: 'payout.failed',
    matrixRow: 'payout_status',
    channels: ['push', 'sms', 'email'],
    template: 'payout_failed',
    category: 'money',
    alwaysOn: false,
    push: { action: 'open', route: 'towpartner://earnings' },
    resolve: (p: PayoutStatusPayload, ctx) =>
      ctx.resolver.resolveWalletOwner(p.ownerType, p.ownerId).then(one),
    variables: (p: PayoutStatusPayload) => ({
      amount: p.amount,
      reason: p.reason ?? '',
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row 1. REGISTERED FOR COMPLETENESS, DELIVERED BY `OtpPort`.
     *
     * The OTP is genuinely a §12.2 row and must be accounted for, but it does
     * not ride the spine, for three independent reasons:
     *
     *  1. `emit()` persists its payload to `notification_events.payload`, a
     *     table with no TTL and no purge until Phase 20. Today the code exists
     *     only as `login_challenges.code_hash` with a 300 s TTL, and
     *     `DevOtpAdapter` refuses to write a live code even to a production log
     *     for exactly this reason. Routing it here would reverse that.
     *  2. Login latency would depend on queue health.
     *  3. `notifications.deliver.sms` is FIFO. A 400-truck compliance sweep
     *     enqueues hundreds of SMS jobs ahead of the next login OTP, whose own
     *     TTL is 300 s — and an SMS delivered after the code expires is worse
     *     than none, because the user sees a code the server rejects.
     *
     * When MSG91 is contracted, `OtpPort` gets its own adapter sharing the same
     * vendor client: one integration, two consumers.
     */
    event: 'otp.requested',
    matrixRow: 'otp',
    channels: ['sms', 'whatsapp'],
    template: 'driver_kyc_approved', // never rendered — `deliveredBy` short-circuits before the catalog
    category: 'transactional',
    alwaysOn: true,
    deliveredBy: 'otp_port',
    resolve: async () => [],
    variables: () => ({}),
  }),


  // --- Phase 17: dispatch -----------------------------------------------------

  defineTrigger({
    /**
     * §12.2 row *new job offered*, and THE ONLY `priority: 'high'` TRIGGER IN THE
     * PRODUCT.
     *
     * A normal-priority push is batched by Android until the next Doze
     * maintenance window, which can be minutes. The offer expires in twenty
     * seconds. Phase 13 built the transport for exactly this row — the
     * `job-offer-v1` channel with `importance: MAX` and `bypassDnd`, created
     * deliberately unused so dispatch would not be the first thing to exercise
     * it — and this is where it is finally used.
     *
     * PUSH ONLY, no SMS or WhatsApp, and that is a deliberate reading of the
     * matrix. An SMS arriving after the offer expired is worse than none: it
     * tells a driver about work they can no longer take, and the §12.3 SMS queue
     * is FIFO behind whatever else is in it.
     */
    event: 'job.offered',
    matrixRow: 'job_offered',
    channels: ['push'],
    template: 'job_offered',
    category: 'transactional',
    alwaysOn: true,
    priority: 'high',
    push: { action: 'open', invalidate: 'offers', route: 'towpartner://offer' },
    /**
     * Keyed on booking + driver, which is exactly one offer.
     *
     * NOT the booking alone: §6.5's re-dispatch legitimately offers the same
     * booking to the same driver's neighbours, and a booking-only key would
     * suppress every offer after the first. NOT booking + driver + wave either —
     * a driver is only ever offered a given booking once (the exclusion set
     * guarantees it), so the wave adds nothing and would let a bug produce two
     * pushes for one offer.
     */
    dedupeKey: (p: JobOfferedPayload) => `${p.bookingId}:${p.driverId}`,
    resolve: (p: JobOfferedPayload, ctx) => ctx.resolver.resolveDriver(p.driverId).then(one),
    variables: (p: JobOfferedPayload) => ({
      amount: p.netAmount,
      pickup: p.pickupAddress,
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row *driver assigned / en route / arrived* — the ASSIGNED third.
     *
     * Three distinct emissions share this row; en route and arrived are Phase
     * 18's and will claim the same `matrixRow` with their own events. That is
     * what the row's own note in `matrix-12-2.ts` anticipates, and it is why
     * `registry.spec.ts` counts a row as covered rather than counting triggers.
     *
     * This is §9.1.6's literal acceptance criterion: "app backgrounded during
     * search → push on match". A customer who put their phone away during a
     * three-minute search finds out a driver is coming.
     */
    event: 'booking.driver_assigned',
    matrixRow: 'driver_assigned_en_route_arrived',
    channels: ['push', 'whatsapp'],
    template: 'booking_driver_assigned',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'bookings', route: 'towgo://bookings' },
    /**
     * The booking id. A booking is assigned exactly once per assignment, and
     * §5.1 has no edge back into `searching` from `assigned` — a driver who
     * cancels goes through `searching` again via §6.5, which is a genuinely new
     * assignment the customer must be told about.
     *
     * ⚠ That made this key WRONG for the re-dispatch case: the second
     * assignment would be suppressed as a duplicate of the first. Phase 18 owns
     * driver-side cancellation and was told to widen this key when it landed —
     * noted here rather than in a ticket, because this is the file that would be
     * open.
     *
     * ✅ WIDENED, PHASE 18. §9.2.3's unable-to-deliver puts a booking back into
     * §6.5's search, and the driver who takes it next is a genuinely new fact the
     * customer must hear — they were told "Ramesh is on the way" twenty minutes
     * ago and Ramesh is not coming. The key now carries the DRIVER, so a second
     * assignment to a different person is a different notification, while a
     * retried fan-out for the same (booking, driver) pair is still suppressed —
     * which is the duplicate the key existed to catch.
     *
     * The remaining collision is the same driver being re-assigned to the same
     * booking after failing on it, which §6.5 forbids: `excludedDrivers()` counts
     * every attempt outcome, so that driver is not a candidate again.
     */
    dedupeKey: (p: DriverAssignedPayload) => `${p.bookingId}:${p.driverId}`,
    resolve: (p: DriverAssignedPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: DriverAssignedPayload) => ({
      driver: p.driverName ?? '',
      reference: p.reference,
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row *driver assigned / en route / arrived* — the EN ROUTE third
     * (Phase 18).
     *
     * The row's own note in `matrix-12-2.ts` said this was coming: "Three
     * distinct emissions sharing one matrix row: assigned is Phase 17, en route
     * and arrived are Phase 18." `registry.spec.ts` counts a ROW as covered
     * rather than counting triggers, which is what makes three legal.
     *
     * WHY THE CUSTOMER IS TOLD AT ALL, given they were told sixty seconds ago
     * that a driver accepted. Because those are different facts and the gap
     * between them is the anxious one: "someone took your job" is a promise, and
     * "they have set off" is the first evidence of it. §5.1 fires this from
     * actual movement (`EnRouteWatcher`), not from a tap, so it cannot be
     * announced by a driver who has not moved.
     */
    event: 'booking.driver_en_route',
    matrixRow: 'driver_assigned_en_route_arrived',
    channels: ['push', 'whatsapp'],
    template: 'booking_driver_en_route',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'bookings', route: 'towgo://bookings' },
    /**
     * Keyed on the pair, like the assignment above. §5.1 has exactly one
     * `assigned → en_route` edge per assignment, and a re-dispatched booking
     * gets a new driver — so this fires once per driver who actually sets off.
     */
    dedupeKey: (p: DriverAssignedPayload) => `${p.bookingId}:${p.driverId}`,
    resolve: (p: DriverAssignedPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: DriverAssignedPayload) => ({
      driver: p.driverName ?? '',
      reference: p.reference,
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row *driver assigned / en route / arrived* — the ARRIVED third
     * (Phase 18).
     *
     * THE MOST TIME-CRITICAL OF THE THREE, and the reason it is `alwaysOn`
     * without argument: the driver is now standing beside a vehicle whose owner
     * may be in a café, and the §7.4 waiting clock has started. Fifteen free
     * minutes then five rupees a minute — a customer who does not know their
     * driver has arrived is being charged for not knowing.
     *
     * §9.1.7 pairs this with a haptic and the OTP card coming forward on the
     * tracking screen; the push is what reaches the phone in a pocket.
     */
    event: 'booking.driver_arrived',
    matrixRow: 'driver_assigned_en_route_arrived',
    channels: ['push', 'whatsapp'],
    template: 'booking_driver_arrived',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'bookings', route: 'towgo://bookings' },
    dedupeKey: (p: DriverAssignedPayload) => `${p.bookingId}:${p.driverId}`,
    resolve: (p: DriverAssignedPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: DriverAssignedPayload) => ({
      driver: p.driverName ?? '',
      reference: p.reference,
    }),
  }),

  defineTrigger({
    /**
     * §12.2's *job started (OTP verified)* — deferred since Phase 13 with the
     * reason "the job-start OTP that triggers it is Phase 18". It is Phase 18.
     *
     * PUSH ONLY, exactly as the matrix row specifies. The customer has just read
     * a six-digit code aloud to a driver standing in front of them, so this is
     * not news — it is a receipt, and the value of it is that it is the moment
     * the vehicle legally changed hands. A WhatsApp for that would be noise.
     */
    event: 'booking.job_started',
    matrixRow: 'job_started',
    channels: ['push'],
    template: 'booking_job_started',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'bookings', route: 'towgo://bookings' },
    /**
     * The booking alone. §5.1 permits exactly one `arrived → in_progress`
     * transition per booking and there is no edge back into `arrived`, so unlike
     * the two above this genuinely cannot happen twice for one trip.
     */
    dedupeKey: (p: DriverAssignedPayload) => p.bookingId,
    resolve: (p: DriverAssignedPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: DriverAssignedPayload) => ({
      driver: p.driverName ?? '',
      reference: p.reference,
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row *search widening / no drivers found* — the widening half.
     *
     * ALWAYS-ON, and this was NOT the first instinct. A "still looking" update
     * twice a minute is exactly the kind of thing someone should be able to
     * mute, and it was written as `alwaysOn: false` — which
     * `registry.spec.ts`'s §12.3 invariant correctly rejected.
     *
     * The invariant is right and the instinct was wrong, for a reason worth
     * recording: `SUBJECT_NOTIFICATION_PREF_DEFAULTS` has exactly two keys,
     * `promotions` and `weeklySummary`. There is no preference a customer could
     * set to suppress this, so `alwaysOn: false` would not have offered them a
     * choice — it would have consulted a key that does not exist. Adding one is
     * a §12.3 decision that needs a settings row and a migration, and inventing
     * it silently inside the dispatch phase is how a preference ends up with no
     * UI. If the volume proves annoying in testing, the fix is a real
     * `searchUpdates` key, not a quiet default.
     */
    event: 'booking.search_widening',
    matrixRow: 'search_widening',
    channels: ['push'],
    template: 'booking_search_widening',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'bookings' },
    /**
     * Keyed on booking + radius, so each RUNG notifies once.
     *
     * Not the booking alone — that would send one update for a three-minute
     * search and defeat the point. Not a timestamp either, which dedupes
     * nothing: the engine can legitimately re-run a wave at the same radius
     * after a worker restart, and the customer should not hear about it twice.
     */
    dedupeKey: (p: SearchWideningPayload) => `${p.bookingId}:${p.radiusKm}`,
    resolve: (p: SearchWideningPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: SearchWideningPayload) => ({ radiusKm: String(p.radiusKm) }),
  }),

  defineTrigger({
    /**
     * The other half of the same §12.2 row — the search gave up.
     *
     * ALWAYS ON, unlike the widening updates it shares a row with. "We could not
     * find anyone" is not a progress update: the customer is standing beside a
     * broken vehicle waiting for help that is not coming, and there is no
     * preference under which they should not be told.
     */
    event: 'booking.no_drivers_found',
    matrixRow: 'search_widening',
    channels: ['push'],
    template: 'booking_no_drivers_found',
    category: 'transactional',
    alwaysOn: true,
    push: { action: 'refetch', invalidate: 'bookings', route: 'towgo://bookings' },
    /**
     * The booking id. §9.1.6's "retry / widen" re-enters the search on the SAME
     * booking, so a second failure after a retry is a second real failure the
     * customer must hear about — and this key would suppress it.
     *
     * ⚠ Same widening needed as `booking.driver_assigned` above, and for the
     * same reason. Left as the booking id today because the retry route is the
     * only producer of a second search and it does not exist until TowGo's
     * button is wired.
     */
    dedupeKey: (p: NoDriversFoundPayload) => p.bookingId,
    resolve: (p: NoDriversFoundPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: NoDriversFoundPayload) => ({ reference: p.reference }),
  }),

  // --- Operational templates -------------------------------------------------
  // Not §12.2 rows. They carry no `matrixRow` claim, and `registry.spec.ts`
  // counts them neither for nor against completeness — the registry has to
  // tolerate internal notifications without them polluting the product matrix.

  defineTrigger({
    event: 'fleet.driver_invited',
    matrixRow: '',
    channels: ['sms'],
    template: 'fleet_driver_invite',
    category: 'transactional',
    alwaysOn: true,
    resolve: (p: DriverInvitePayload, ctx) => ctx.resolver.resolveDriver(p.driverId).then(one),
    variables: (p: DriverInvitePayload) => ({ businessName: p.businessName }),
  }),

  defineTrigger({
    event: 'ops.ledger_drift',
    matrixRow: '',
    channels: ['email'],
    template: 'ops_ledger_drift',
    category: 'transactional',
    alwaysOn: true,
    /**
     * The one trigger whose recipient is not a subject in the database — it is
     * an operations mailbox from `LEDGER_OPS_EMAIL`. Synthesised rather than
     * resolved, which is why it carries `subjectType: 'fleet'` with a null id
     * substitute: it never writes an inbox row (no subject can read it) and
     * exists purely to reuse the retry ladder and the DLQ.
     */
    resolve: async (p: OpsLedgerDriftPayload) => [
      {
        subjectType: 'fleet' as const,
        subjectId: '00000000-0000-0000-0000-000000000000',
        mobile: null,
        email: p.opsEmail,
        pushTokens: [],
        prefs: {},
      },
    ],
    variables: (p: OpsLedgerDriftPayload) => ({
      day: p.day,
      driftPaise: String(p.driftPaise),
    }),
  }),
  // ── Phase 19: money ─────────────────────────────────────────────────────

  defineTrigger({
    /**
     * §12.2 row *Completed + invoice*.
     *
     * `money`, not `transactional`, and that is a deliberate opt-out decision:
     * the registry FORCES `transactional` and `safety` to be `alwaysOn`, and an
     * invoice email is not a legally unsuppressible message the way an OTP or a
     * safety alert is. `SUBJECT_NOTIFICATION_PREF_DEFAULTS` already ships the
     * toggle this honours.
     *
     * The EMAIL CARRIES THE PDF — `attachmentsFor` below. §12.2's own note said
     * "the attachment wiring lands with the invoice PDF in Phase 19"; this is it.
     */
    event: 'booking.completed_invoice',
    matrixRow: 'completed_invoice',
    channels: ['push', 'whatsapp', 'email'],
    template: 'job_invoice_email',
    category: 'money',
    alwaysOn: false,
    push: { action: 'open', route: 'moveyo://bookings', invalidate: 'bookings' },
    dedupeKey: (p: CompletedInvoicePayload) => p.bookingId,
    attachmentsFor: (p: CompletedInvoicePayload) => ({ kind: 'invoice', bookingId: p.bookingId }),
    resolve: (p: CompletedInvoicePayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: CompletedInvoicePayload) => ({
      bookingRef: p.bookingId.slice(0, 8).toUpperCase(),
      amount: p.amount,
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row *Payment success / failure*, the SUCCESS half.
     *
     * TWO TRIGGERS SHARE THIS ROW, because the matrix note says "SMS is marked
     * (fail) — success does not SMS", and `registry.spec.ts` permits a trigger
     * to use FEWER channels than its row grants but never more. Exactly the
     * shape `payout.processed` and `payout.failed` already use.
     */
    event: 'payment.succeeded',
    matrixRow: 'payment_status',
    channels: ['push', 'email'],
    template: 'payment_receipt_email',
    category: 'money',
    alwaysOn: false,
    push: { action: 'refetch', invalidate: 'bookings', route: 'moveyo://bookings' },
    dedupeKey: (p: PaymentStatusPayload) => p.paymentId,
    resolve: (p: PaymentStatusPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: PaymentStatusPayload) => ({
      bookingRef: p.bookingId.slice(0, 8).toUpperCase(),
      amount: p.amount,
      status: 'successful',
    }),
  }),

  defineTrigger({
    /** The FAILURE half — and the only one that SMSes, per the matrix note. */
    event: 'payment.failed',
    matrixRow: 'payment_status',
    channels: ['push', 'sms', 'email'],
    template: 'payment_receipt_email',
    category: 'money',
    alwaysOn: false,
    push: { action: 'refetch', invalidate: 'bookings', route: 'moveyo://bookings' },
    dedupeKey: (p: PaymentStatusPayload) => `${p.paymentId}:failed`,
    resolve: (p: PaymentStatusPayload, ctx) => ctx.resolver.resolveUser(p.userId).then(one),
    variables: (p: PaymentStatusPayload) => ({
      bookingRef: p.bookingId.slice(0, 8).toUpperCase(),
      amount: p.amount,
      status: 'unsuccessful',
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row *Earnings credited (per trip)* — Driver, PUSH ONLY.
     *
     * Not to be confused with `ops.ledger_drift`, which is an internal alarm
     * over the same table and goes to an ops mailbox rather than to a person.
     */
    event: 'earnings.credited',
    matrixRow: 'earnings_credited',
    channels: ['push'],
    template: 'earnings_credited',
    category: 'money',
    alwaysOn: false,
    push: { action: 'refetch', invalidate: 'driver.earnings', route: 'towpartner://earnings' },
    dedupeKey: (p: EarningsCreditedPayload) => p.bookingId,
    resolve: (p: EarningsCreditedPayload, ctx) => ctx.resolver.resolveDriver(p.driverId).then(one),
    variables: (p: EarningsCreditedPayload) => ({
      amount: p.amount,
      bookingRef: p.bookingId.slice(0, 8).toUpperCase(),
    }),
  }),

  defineTrigger({
    /**
     * §12.2 row *Weekly earnings summary* — Driver.
     *
     * The `weeklySummary` preference key shipped in Phase 13 SPECIFICALLY so
     * this opt-out existed before the first send ever went out. It does.
     */
    event: 'earnings.weekly',
    matrixRow: 'weekly_earnings',
    channels: ['push', 'whatsapp'],
    template: 'weekly_earnings',
    category: 'money',
    alwaysOn: false,
    push: { action: 'open', route: 'towpartner://earnings', invalidate: 'driver.earnings' },
    // One digest per driver per week, whatever the job's redelivery does.
    dedupeKey: (p: WeeklyEarningsPayload) => `${p.driverId}:${p.weekLabel}`,
    resolve: (p: WeeklyEarningsPayload, ctx) => ctx.resolver.resolveDriver(p.driverId).then(one),
    variables: (p: WeeklyEarningsPayload) => ({
      amount: p.amount,
      jobs: p.jobs,
      weekLabel: p.weekLabel,
    }),
  }),
];

// ---------------------------------------------------------------------------
// Deferred — declared, not forgotten
// ---------------------------------------------------------------------------

export const DEFERRED_TRIGGERS: DeferredTrigger[] = [
  {
    matrixRow: 'sos',
    unregisteredUntilPhase: 20,
    reason:
      '`sos_alerts`, `POST /v1/sos` and the emergency-contact fan-out are Phase 20. The WhatsApp adapter and the always-on `safety` category ship here so Phase 20 invents nothing.',
  },
  {
    matrixRow: 'dispute_update',
    unregisteredUntilPhase: 20,
    reason:
      'Phase 20, not 19: `POST /v1/admin/bookings/:id/dispute` is the only thing that can set DISPUTED, and it is in the Phase 20 block.',
  },
];

/** Registered triggers indexed by event, built once. */
export const TRIGGERS_BY_EVENT = new Map<string, RegisteredTrigger<never>>(
  REGISTERED_TRIGGERS.map((trigger) => [trigger.event, trigger]),
);
