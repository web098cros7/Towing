import type { RenderedMessage } from './channel.port';

/**
 * §12.3's "content stored as templates" — as a TYPED CONST MAP, not a table.
 *
 * A NON-GOAL, RECORDED SO IT IS NOT REDISCOVERED: there is no admin
 * template-management UI in this phase and there should not be one later
 * either. SMS bodies must be DLT-registered with the regulator and WhatsApp
 * bodies approved by Meta, both referenced by an ID the provider issues — so an
 * admin editing body text at runtime would *break* compliance rather than
 * enable it, by desynchronising what we send from what was approved. The most
 * that is ever justified is a read-only viewer, and that belongs with Phase
 * 20's thin config screens.
 *
 * `dltTemplateId` and `waTemplateName` are null on every row today because
 * neither registration has happened (`ToBeDoneEhsan.md`). The adapters treat
 * null as a hard "cannot send" rather than falling back to free text, which is
 * what keeps the reason legible in `notification_deliveries.last_error`
 * instead of arriving as an opaque vendor 4xx.
 *
 * FOUR EMAIL TEMPLATES SHIP, TWO ARE WIRED. Plan L1100 asks for all four of
 * §12.2's email-required rows; only compliance-expiring and payout have live
 * emitters today, so `job_invoice_email` and `payment_receipt_email` sit here
 * with their variable sets agreed, waiting for Phase 19 to register a trigger
 * against them.
 */

export interface TemplateDefinition {
  /** DLT-registered id (MSG91). Null until registration lands. */
  dltTemplateId: string | null;
  /** Meta-approved template name. Null until BSP approval lands. */
  waTemplateName: string | null;
  /**
   * The order body parameters are sent in for providers that take them
   * POSITIONALLY ({{1}}, {{2}}…). WhatsApp Cloud API does, so this ordering is
   * part of the approved template's contract, not a formatting preference.
   */
  orderedVariables: string[];
  render: (v: Record<string, string>) => RenderedMessage;
}

export const TEMPLATES = {
  driver_kyc_approved: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['name'],
    render: (v) => ({
      title: 'You are verified',
      // Spec §12.2's own words for this row.
      body: `${v.name ?? 'Hi'}, your documents are approved. You can start earning now — go online in TowPartner.`,
      subject: null,
    }),
  },

  driver_kyc_rejected: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['name', 'reason'],
    render: (v) => ({
      title: 'Verification unsuccessful',
      body: `${v.name ?? 'Hi'}, we could not verify your documents. Reason: ${v.reason ?? 'not given'}. Open TowPartner to resubmit.`,
      subject: null,
    }),
  },

  driver_kyc_request_info: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['name', 'reason'],
    render: (v) => ({
      title: 'We need more information',
      body: `${v.name ?? 'Hi'}, we need more from you before we can verify your account: ${v.reason ?? 'see the app'}. Open TowPartner to continue.`,
      subject: null,
    }),
  },

  fleet_compliance_expiring: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['docType', 'plate', 'daysLeft'],
    render: (v) => ({
      title: 'A document is expiring',
      body: `${v.docType ?? 'A document'} for ${v.plate ?? 'one of your trucks'} expires in ${v.daysLeft ?? '30'} days. Renew it in the TowFleet console to keep the truck dispatchable.`,
      subject: `Action needed: ${v.docType ?? 'document'} expires in ${v.daysLeft ?? '30'} days`,
    }),
  },

  /**
   * §12.2 "Booking confirmed" → Customer, on push + SMS + WhatsApp.
   *
   * No `subject`: email is not a channel on this matrix row, and a non-null
   * subject would be dead text nothing renders. `title` MUST be non-null —
   * `emit()` titles the in-app inbox row with `title ?? subject ?? event`, and
   * falling through to the raw event key is how a customer ends up reading
   * "booking.confirmed" in their notification centre.
   */
  booking_confirmed: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['reference', 'service', 'amount'],
    render: (v) => ({
      title: 'Booking confirmed',
      body: `Your ${v.service ?? 'tow'} is confirmed (${v.reference ?? '—'}). Fare ${v.amount ?? ''} — we are finding you a driver now.`,
      subject: null,
    }),
  },

  /**
   * §12.2's *new job offered*. THE ONLY HIGH-PRIORITY PUSH IN THE PRODUCT.
   *
   * The body leads with the NET figure, not the fare: a driver deciding in
   * twenty seconds is deciding on what they take home, and the gross would
   * over-state it by the commission every single time. The pickup follows,
   * because "is it near me" is the second question.
   */
  job_offered: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['amount', 'pickup'],
    render: (v) => ({
      title: `New job — you earn ${v.amount ?? ''}`,
      body: `Pickup at ${v.pickup ?? 'a nearby location'}. Tap to accept before it expires.`,
      subject: null,
    }),
  },

  /**
   * §12.2's *driver assigned*, and §9.1.6's literal AC: "app backgrounded
   * during search → push on match". This is the message that ends the wait.
   */
  booking_driver_assigned: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['driver', 'reference'],
    render: (v) => ({
      title: 'Driver on the way',
      body: `${v.driver || 'Your driver'} has accepted your request (${v.reference ?? '—'}) and is heading to you.`,
      subject: null,
    }),
  },

  /**
   * §12.2's *driver assigned / en route / arrived* — the second of three
   * emissions on that row (Phase 18).
   */
  booking_driver_en_route: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['driver', 'reference'],
    render: (v) => ({
      title: 'Your driver has set off',
      body: `${v.driver || 'Your driver'} is on the way to your pickup (${v.reference ?? '—'}). You can follow them live in the app.`,
      subject: null,
    }),
  },

  /**
   * The third emission, and the one the customer most needs to act on.
   *
   * IT NAMES THE OTP WITHOUT CARRYING IT. §7.4's waiting clock starts here — 15
   * free minutes, then per-minute — so the body has to move somebody who may be
   * indoors, and the thing they have to do is read a code to the driver. The code
   * itself stays out of every channel: it lives hashed on the booking and is
   * readable only through `GET /bookings/:id/otp` by its owner, which is the
   * posture Phase 13 declined to reverse for login OTPs and this does not reverse
   * either.
   */
  booking_driver_arrived: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['driver', 'reference'],
    render: (v) => ({
      title: 'Your driver has arrived',
      body: `${v.driver || 'Your driver'} is at your pickup location (${v.reference ?? '—'}). Open the app for your collection code.`,
      subject: null,
    }),
  },

  /** §12.2's *job started (OTP verified)* — the receipt for the handover. */
  booking_job_started: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['driver', 'reference'],
    render: (v) => ({
      title: 'Your tow has started',
      body: `${v.driver || 'Your driver'} has collected your vehicle (${v.reference ?? '—'}) and is on the way to the drop location.`,
      subject: null,
    }),
  },

  /**
   * §12.2's *search widening*.
   *
   * Names the radius rather than saying "still looking", because a customer
   * watching a spinner needs evidence that something is actually happening —
   * and "we're now searching 7 km" is the difference between patience and
   * cancelling.
   */
  booking_search_widening: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['radiusKm'],
    render: (v) => ({
      title: 'Still finding you a driver',
      body: `We have widened the search to ${v.radiusKm ?? ''} km to reach more drivers nearby.`,
      subject: null,
    }),
  },

  /** The other half of the same §12.2 row — the search gave up. */
  booking_no_drivers_found: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['reference'],
    render: (v) => ({
      title: 'No drivers available',
      body: `We could not find a driver for ${v.reference ?? 'your booking'} right now. Your price is held — tap to try again.`,
      subject: null,
    }),
  },

  payout_paid: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['amount', 'reference'],
    render: (v) => ({
      title: 'Payout sent',
      body: `Your payout of ${v.amount ?? ''} is on its way to your bank account. Reference ${v.reference ?? '—'}.`,
      subject: `Payout of ${v.amount ?? ''} processed`,
    }),
  },

  payout_failed: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['amount', 'reason'],
    render: (v) => ({
      title: 'Payout failed',
      body: `Your payout of ${v.amount ?? ''} could not be sent (${v.reason ?? 'reason unavailable'}). The money is back in your wallet — check your bank details and try again.`,
      subject: `Payout of ${v.amount ?? ''} failed`,
    }),
  },

  fleet_driver_invite: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['businessName'],
    render: (v) => ({
      title: 'You have been invited to drive',
      body: `${v.businessName ?? 'A fleet'} has invited you to drive with them. Download TowPartner and sign in with this number to get started.`,
      subject: null,
    }),
  },

  ops_ledger_drift: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['day', 'driftPaise'],
    render: (v) => ({
      title: 'Ledger drift detected',
      body: `Nightly reconciliation found ${v.driftPaise ?? '?'} paise of drift for ${v.day ?? 'an unknown day'}. Investigate before the next payout run.`,
      subject: `[ops] Ledger drift on ${v.day ?? 'unknown day'}`,
    }),
  },

  // --- Shipped, not yet wired (Phase 19 registers triggers against these) ----

  /** §12.2 "Completed + invoice". The PDF attachment lands with Phase 19's invoice. */
  job_invoice_email: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['bookingRef', 'amount'],
    render: (v) => ({
      title: 'Your trip is complete',
      body: `Thanks for riding with us. Booking ${v.bookingRef ?? ''} is complete and your invoice for ${v.amount ?? ''} is attached.`,
      subject: `Invoice for booking ${v.bookingRef ?? ''}`,
    }),
  },

  /**
   * §12.2 "Earnings credited (per trip)" — Driver, PUSH ONLY.
   *
   * The matrix grants this row exactly one channel and `registry.spec.ts`
   * refuses any trigger that uses more, which is right: a driver completing
   * eight trips a day does not want eight emails, and the number is already in
   * the app.
   */
  earnings_credited: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['amount', 'bookingRef'],
    render: (v) => ({
      title: `${v.amount ?? ''} credited`,
      body: `Your earnings for booking ${v.bookingRef ?? ''} are in your wallet.`,
      // Push and WhatsApp only — neither has a subject.
      subject: null,
    }),
  },

  /** §12.2 "Weekly earnings summary" — Driver. The `weeklySummary` opt-out has shipped since Phase 13. */
  weekly_earnings: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['amount', 'jobs', 'weekLabel'],
    render: (v) => ({
      title: 'Your week in numbers',
      body: `You earned ${v.amount ?? ''} across ${v.jobs ?? '0'} trips in the week of ${v.weekLabel ?? ''}.`,
      subject: null,
    }),
  },

  /** §12.2 "Payment success / failure". */
  payment_receipt_email: {
    dltTemplateId: null,
    waTemplateName: null,
    orderedVariables: ['bookingRef', 'amount', 'status'],
    render: (v) => ({
      title: v.status === 'failed' ? 'Payment failed' : 'Payment received',
      body:
        v.status === 'failed'
          ? `We could not collect ${v.amount ?? ''} for booking ${v.bookingRef ?? ''}. Please try another payment method.`
          : `We received ${v.amount ?? ''} for booking ${v.bookingRef ?? ''}. Your receipt is below.`,
      subject: `Receipt for booking ${v.bookingRef ?? ''}`,
    }),
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATES;

export function renderTemplate(
  key: TemplateKey,
  variables: Record<string, string>,
): RenderedMessage {
  return TEMPLATES[key].render(variables);
}
