import type { AdminFinanceConfigDto, AdminPayoutDto } from '@towing/api-contracts';

const HOUR = 60 * 60 * 1000;

/**
 * §9.4.10's queue, with BOTH owner types present.
 *
 * Fleet payouts joined §14.4's threshold in Phase 19 — they bypassed approval
 * entirely from Track A Phase 7 until then — so a queue fixture containing only
 * drivers would let the console ship without anybody noticing that fleets now
 * appear in it too.
 */
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
