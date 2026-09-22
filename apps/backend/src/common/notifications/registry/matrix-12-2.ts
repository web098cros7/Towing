import type { NotificationChannel } from '@towing/api-contracts';

/**
 * A LITERAL TRANSCRIPTION OF SPEC §12.2 — all sixteen rows, in spec order,
 * with the exact channel cells the table gives.
 *
 * ⚠ THIS FILE IS THE SPEC, NOT THE IMPLEMENTATION. It is deliberately dumb
 * data with no behaviour, so that `registry.spec.ts` can compare what the
 * product PROMISED against what the code actually registers.
 *
 * ⚠ EDITING A ROW TO MAKE A TEST PASS IS THE FAILURE MODE THIS EXISTS TO
 * PREVENT. If a row is wrong, the spec document is wrong and both change
 * together, in a commit that says so. If a row is not implemented yet, it gets
 * an `unregisteredUntilPhase` entry in `triggers.ts` — it does NOT get deleted
 * from here, and it does NOT get silently dropped.
 *
 * The mechanism this enables: every later phase that emits an event wires its
 * §12.2 row in the same commit, because `registry.spec.ts` fails on any row
 * that is neither registered nor explicitly deferred, and prints the deferred
 * ones by name so nobody has to remember they exist. Without it, "we forgot to
 * notify the customer" is discovered by a customer.
 */

export interface MatrixRow {
  /** Stable key. Used by `triggers.ts` to claim a row; never renamed lightly. */
  key: string;
  /** The §12.2 "Event" cell, verbatim. */
  label: string;
  /** The §12.2 "Recipient" cell, verbatim. */
  recipient: string;
  /** The ✅ cells, in channel order. `(opt)`/`(fail)`/`(web)` qualifiers noted below. */
  channels: NotificationChannel[];
  /** Anything the table qualifies in parentheses, preserved so it is not lost. */
  note?: string;
}

export const MATRIX_12_2: readonly MatrixRow[] = [
  {
    key: 'otp',
    label: 'OTP (login / booking)',
    recipient: 'User/Driver',
    channels: ['sms', 'whatsapp'],
    note: 'WhatsApp is marked (opt). The booking OTP half does not exist until Phase 18.',
  },
  {
    key: 'kyc_approved',
    label: 'KYC approved ("You can start earning now")',
    recipient: 'Driver',
    channels: ['push', 'sms', 'whatsapp'],
  },
  {
    key: 'kyc_rejected',
    label: 'KYC rejected / request info',
    recipient: 'Driver',
    channels: ['push', 'sms', 'whatsapp'],
  },
  {
    key: 'job_offered',
    label: 'New job offered (net earning shown)',
    recipient: 'Driver',
    channels: ['push'],
    note: 'Push is marked (high-priority) — the Android channel and the transport ship in Phase 13, the offer itself in 17.',
  },
  {
    key: 'booking_confirmed',
    label: 'Booking confirmed',
    recipient: 'Customer',
    channels: ['push', 'sms', 'whatsapp'],
  },
  {
    key: 'driver_assigned_en_route_arrived',
    label: 'Driver assigned / en route / arrived',
    recipient: 'Customer',
    channels: ['push', 'whatsapp'],
    note: 'Three distinct emissions sharing one matrix row: assigned is Phase 17, en route and arrived are Phase 18.',
  },
  {
    key: 'search_widening',
    label: 'Search widening / no drivers found',
    recipient: 'Customer',
    channels: ['push'],
  },
  {
    key: 'job_started',
    label: 'Job started (OTP verified)',
    recipient: 'Customer',
    channels: ['push'],
  },
  {
    key: 'completed_invoice',
    label: 'Completed + invoice',
    recipient: 'Customer',
    channels: ['push', 'whatsapp', 'email'],
    note: 'Email is marked (invoice) — the attachment wiring lands with the invoice PDF in Phase 19.',
  },
  {
    key: 'payment_status',
    label: 'Payment success / failure',
    recipient: 'Customer',
    channels: ['push', 'sms', 'email'],
    note: 'SMS is marked (fail) — success does not SMS. Email is marked (receipt).',
  },
  {
    key: 'earnings_credited',
    label: 'Earnings credited (per trip: net amount)',
    recipient: 'Driver',
    channels: ['push'],
  },
  {
    key: 'weekly_earnings',
    label: 'Weekly earnings summary',
    recipient: 'Driver',
    channels: ['push', 'whatsapp'],
  },
  {
    key: 'compliance_doc_expiring',
    label: 'Compliance doc expiring (30d)',
    recipient: 'Fleet',
    channels: ['whatsapp', 'email'],
    note: "The table's fourth cell is ✅ (web), not push — satisfied since Phase 6 by the console's /alerts page, which is why this row registers only WhatsApp and email.",
  },
  {
    key: 'payout_status',
    label: 'Payout processed / failed',
    recipient: 'Driver/Fleet',
    channels: ['push', 'sms', 'email'],
    note: 'Phase 13 wires the FLEET recipient only; driver payouts arrive in Phase 19.',
  },
  {
    key: 'sos',
    label: 'SOS triggered',
    recipient: 'Emergency contacts + Ops',
    channels: ['push', 'sms', 'whatsapp'],
    note: 'Push is marked (ops). W14 claims this row: `sos.triggered` fans out to the contact snapshot over SMS + WhatsApp, and `sos.ops_alert` (operational) reaches the on-call admins — admins have no push devices, so the socket frame plus email/SMS is their alert path.',
  },
  {
    key: 'dispute_update',
    label: 'Dispute update',
    recipient: 'Customer/Driver',
    channels: ['push', 'whatsapp'],
    note: "Phase 20, not 19: POST /v1/admin/bookings/:id/dispute — the only thing that can set DISPUTED — is in the Phase 20 block. The plan's Phase 19 list was corrected to match.",
  },
] as const;

/** The count is asserted, so adding or losing a row is a test failure rather than a silent drift. */
export const MATRIX_12_2_ROW_COUNT = 16;
