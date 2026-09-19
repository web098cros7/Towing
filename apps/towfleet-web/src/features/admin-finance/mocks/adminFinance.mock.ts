import type {
  AdminFinanceConfigDto,
  AdminInvariantsResponse,
  AdminLedgerEntryDto,
  AdminPayoutDto,
  AdminPayoutSlaResponse,
  AdminRefundRowDto,
  AdminTransactionDto,
} from '@towing/api-contracts';

const HOUR = 60 * 60 * 1000;

/**
 * §9.4.10's queue, with BOTH owner types present.
 *
 * Fleet payouts joined §14.4's threshold in Phase 19 — they bypassed approval
 * entirely from Track A Phase 7 until then — so a queue fixture containing only
 * drivers would let the console ship without anybody noticing that fleets now
 * appear in it too.
 */
/**
 * A20's overflow: 51 more queued payouts, so the pending filter holds 53 and
 * `all` holds 55 — both past one page of 50. Deterministic valid UUIDs and
 * names that collide with none of the canonical rows the specs assert on.
 */
const mockUuid = (n: number): string => {
  const h = (x: number) => x.toString(16).padStart(4, '0');
  return `${h(n)}${h(n * 7)}-${h(n * 13)}-4${h(n * 29).slice(1)}-8${h(n * 37).slice(1)}-${h(n * 43)}${h(n * 51)}${h(n * 57).slice(0, 4)}`;
};

const overflowPayouts: AdminPayoutDto[] = Array.from({ length: 51 }, (_, i): AdminPayoutDto => {
  const n = i + 1;
  return {
    id: mockUuid(n),
    ownerType: 'driver',
    ownerId: mockUuid(1000 + n),
    ownerName: `Load Test Driver ${String(n).padStart(2, '0')}`,
    amountPaise: 500_000 + n * 10_000,
    status: 'requested',
    approvalState: 'pending_approval',
    requestedAt: new Date(Date.now() - (n + 4) * HOUR).toISOString(),
    approvedAt: null,
    rejectionReason: null,
    failureReason: null,
    destinationLast4: String(1000 + n).slice(-4),
    bankName: 'HDFC Bank',
  };
});

export const adminPayoutsMock: AdminPayoutDto[] = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    ownerType: 'driver',
    ownerId: '11111111-1111-4111-8111-111111111111',
    ownerName: 'Ramesh Kumar',
    amountPaise: 1_500_000,
    status: 'requested',
    approvalState: 'pending_approval',
    requestedAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    approvedAt: null,
    rejectionReason: null,
    failureReason: null,
    destinationLast4: '4021',
    bankName: 'HDFC Bank',
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    ownerType: 'fleet',
    ownerId: '22222222-2222-4222-8222-222222222222',
    ownerName: 'Bengaluru Towing Co.',
    amountPaise: 18_500_000,
    status: 'requested',
    approvalState: 'pending_approval',
    requestedAt: new Date(Date.now() - 26 * HOUR).toISOString(),
    approvedAt: null,
    rejectionReason: null,
    failureReason: null,
    destinationLast4: '7788',
    bankName: 'ICICI Bank',
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    ownerType: 'driver',
    ownerId: '33333333-3333-4333-8333-333333333333',
    ownerName: 'Anil Prasad',
    amountPaise: 2_400_000,
    status: 'processing',
    approvalState: 'approved',
    requestedAt: new Date(Date.now() - 50 * HOUR).toISOString(),
    approvedAt: new Date(Date.now() - 48 * HOUR).toISOString(),
    rejectionReason: null,
    failureReason: null,
    destinationLast4: '1190',
    bankName: 'Axis Bank',
  },
  {
    // A rejected row, so the reason column is exercised rather than assumed.
    id: '88888888-8888-4888-8888-888888888888',
    ownerType: 'driver',
    ownerId: '44444444-4444-4444-8444-444444444444',
    ownerName: 'Suresh Nair',
    amountPaise: 3_200_000,
    status: 'failed',
    approvalState: 'rejected',
    requestedAt: new Date(Date.now() - 72 * HOUR).toISOString(),
    approvedAt: new Date(Date.now() - 70 * HOUR).toISOString(),
    rejectionReason: 'Bank details do not match the KYC name',
    failureReason: 'Rejected by Finance: Bank details do not match the KYC name',
    destinationLast4: '6543',
    bankName: 'SBI',
  },
  ...overflowPayouts,
];

/** The launch money policy — GST at ZERO, which is the whole premise. */
export const adminFinanceConfigMock: AdminFinanceConfigDto = {
  payoutAutoApproveMaxPaise: 10_000_000,
  taxPct: 0,
  taxLabel: 'GST',
  cancelFreeMinutes: 2,
  cancelPartialMinutes: 10,
  cancelPartialFeePaise: 15_000,
  cancelDriverCompPct: 50,
};

// ---------------------------------------------------------------------------
// W9 — the console reads
// ---------------------------------------------------------------------------

const DAY = 24 * HOUR;

/**
 * Payments, spanning the states an operator reconciles: a settled capture, a
 * PARTIALLY refunded capture (the W8 arithmetic made visible), a failed UPI
 * attempt, and a full reversal.
 */
export const adminTransactionsMock: AdminTransactionDto[] = [
  {
    id: 'c1000000-0000-4000-8000-000000000001',
    bookingId: '44444444-4444-4444-8444-444444444444',
    bookingCode: 'TW-4D5E6F70',
    purpose: 'booking',
    status: 'captured',
    method: 'upi',
    amountPaise: 240_000,
    taxPaise: 0,
    refundedAmountPaise: 0,
    gatewayRef: 'pay_dev_4d5e6f70',
    customerName: 'Lakshmi Devi',
    failureReason: null,
    capturedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000002',
    bookingId: '77777777-7777-4777-8777-777777777777',
    bookingCode: 'TW-708192A3',
    purpose: 'booking',
    status: 'captured',
    method: 'card',
    amountPaise: 150_000,
    taxPaise: 0,
    // The partial already told the story: captured, and 500 of 1500 back.
    refundedAmountPaise: 50_000,
    gatewayRef: 'pay_dev_708192a3',
    customerName: 'Arun Kumar',
    failureReason: null,
    capturedAt: new Date(Date.now() - 4 * DAY).toISOString(),
    createdAt: new Date(Date.now() - 4 * DAY).toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000003',
    bookingId: '33333333-3333-4333-8333-333333333333',
    bookingCode: 'TW-3C4D5E6F',
    purpose: 'booking',
    status: 'failed',
    method: 'upi',
    amountPaise: 96_000,
    taxPaise: 0,
    refundedAmountPaise: 0,
    gatewayRef: null,
    customerName: 'Vikram Rao',
    failureReason: 'Customer abandoned the payment sheet',
    capturedAt: null,
    createdAt: new Date(Date.now() - DAY).toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000004',
    bookingId: '55555555-5555-4555-8555-555555555555',
    bookingCode: 'TW-5E6F7081',
    purpose: 'booking',
    status: 'refunded',
    method: 'upi',
    amountPaise: 45_000,
    taxPaise: 0,
    refundedAmountPaise: 45_000,
    gatewayRef: 'pay_dev_5e6f7081',
    customerName: 'Farhan Ali',
    failureReason: null,
    capturedAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    createdAt: new Date(Date.now() - 8 * HOUR).toISOString(),
  },
];

/**
 * The ledger feed, signed and time-ordered: a settlement credit, the partial
 * refund clawback against it, and a payout debit — the three-leg story a
 * driver's balance actually is.
 */
export const adminLedgerMock: AdminLedgerEntryDto[] = [
  {
    id: 'd1000000-0000-4000-8000-000000000001',
    ownerType: 'driver',
    ownerId: 'd0000000-0000-4000-8000-000000000001',
    ownerName: 'Anil Prasad',
    type: 'driver_share_credit',
    amountPaise: 135_000,
    reason: 'Settlement credit',
    refId: '77777777-7777-4777-8777-777777777777',
    bookingCode: 'TW-708192A3',
    idempotencyKey: 'bk:v1:77777777:driver',
    createdAt: new Date(Date.now() - 4 * DAY).toISOString(),
  },
  {
    id: 'd1000000-0000-4000-8000-000000000002',
    ownerType: 'driver',
    ownerId: 'd0000000-0000-4000-8000-000000000001',
    ownerName: 'Anil Prasad',
    type: 'refund_debit',
    amountPaise: -50_000,
    reason: 'Partial refund clawback (driver)',
    refId: '77777777-7777-4777-8777-777777777777',
    bookingCode: 'TW-708192A3',
    idempotencyKey: 'rf:v2:77777777:partial:driver',
    createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
  },
  {
    id: 'd1000000-0000-4000-8000-000000000003',
    ownerType: 'driver',
    ownerId: 'd0000000-0000-4000-8000-000000000001',
    ownerName: 'Anil Prasad',
    type: 'payout_debit',
    amountPaise: -85_000,
    reason: 'Payout requested',
    refId: null,
    bookingCode: null,
    idempotencyKey: 'po:v1:d0000001',
    createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
  },
  {
    id: 'd1000000-0000-4000-8000-000000000004',
    ownerType: 'fleet',
    ownerId: 'f0000000-0000-4000-8000-000000000001',
    ownerName: 'Bengaluru Towing Co.',
    type: 'fleet_share_credit',
    amountPaise: 196_800,
    reason: 'Fleet share',
    refId: '44444444-4444-4444-8444-444444444444',
    bookingCode: 'TW-4D5E6F70',
    idempotencyKey: 'bk:v1:44444444:fleet',
    createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
  },
  {
    id: 'd1000000-0000-4000-8000-000000000005',
    ownerType: 'driver',
    ownerId: 'd0000000-0000-4000-8000-000000000002',
    ownerName: 'Suresh Nair',
    type: 'adjustment',
    amountPaise: 25_000,
    reason: 'Goodwill adjustment',
    refId: null,
    bookingCode: null,
    idempotencyKey: 'adj:v1:d0000002',
    createdAt: new Date(Date.now() - 12 * HOUR).toISOString(),
  },
];

export const adminRefundsMock: AdminRefundRowDto[] = [
  {
    id: 'e0000000-0000-4000-8000-000000000001',
    bookingId: '77777777-7777-4777-8777-777777777777',
    bookingCode: 'TW-708192A3',
    kind: 'partial',
    amountPaise: 50_000,
    reason: 'Distance log reviewed: refunded the overcharged distance',
    status: 'processed',
    disputeId: 'a3a3a3a3-3333-4333-8333-333333333333',
    liability: 'driver',
    initiatedBy: '1c000000-0000-4000-8000-000000000001',
    gatewayRef: 'rfnd_dev_708192a3',
    processedAt: new Date(Date.now() - 3 * DAY).toISOString(),
    createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
  },
  {
    id: 'e0000000-0000-4000-8000-000000000002',
    bookingId: '55555555-5555-4555-8555-555555555555',
    bookingCode: 'TW-5E6F7081',
    kind: 'full',
    amountPaise: 45_000,
    reason: 'Tow never reached the drop location — full reversal',
    status: 'processed',
    disputeId: null,
    liability: null,
    initiatedBy: 'system',
    gatewayRef: 'rfnd_dev_5e6f7081',
    processedAt: new Date(Date.now() - 5 * HOUR).toISOString(),
    createdAt: new Date(Date.now() - 5 * HOUR).toISOString(),
  },
  {
    id: 'e0000000-0000-4000-8000-000000000003',
    bookingId: '44444444-4444-4444-8444-444444444444',
    bookingCode: 'TW-4D5E6F70',
    kind: 'partial',
    amountPaise: 20_000,
    reason: 'Waiting charge disputed — refund pending at the gateway',
    status: 'pending',
    disputeId: 'a1a1a1a1-1111-4111-8111-111111111111',
    liability: 'platform',
    initiatedBy: '1c000000-0000-4000-8000-000000000001',
    gatewayRef: null,
    processedAt: null,
    createdAt: new Date(Date.now() - HOUR).toISOString(),
  },
];

/**
 * The invariants panel, healthy. These are the SAME five the nightly job
 * asserts; the console's job is to make "all zero" visible without shell
 * access, not to re-derive them.
 */
export const adminInvariantsMock: AdminInvariantsResponse = {
  checkedAt: new Date().toISOString(),
  ok: true,
  invariants: [
    { key: 'walletDrift', label: 'Wallet balance = sum of its ledger entries', drift: 0 },
    { key: 'bookingDrift', label: 'Commission + payout + tax = total (paid bookings)', drift: 0 },
    { key: 'ledgerDrift', label: 'Credited legs = the recorded driver payout', drift: 0 },
    { key: 'reversalDrift', label: 'No booking refunded beyond what it was credited', drift: 0 },
    { key: 'couponDrift', label: 'Coupon used_count = its redemption rows', drift: 0 },
  ],
  driftedWallets: [],
};

/** §14.4's decision latency — healthy-ish: a p50 inside the hour, a fat tail. */
export const adminPayoutSlaMock: AdminPayoutSlaResponse = {
  windowDays: 30,
  decided: 48,
  p50Minutes: 42.5,
  p95Minutes: 610.2,
  breaches24h: 2,
  pendingOver24h: 3,
  generatedAt: new Date().toISOString(),
};
