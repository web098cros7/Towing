import type {
  AdminCommissionConfig,
  AdminCommissionProposal,
  CommissionHistoryEntry,
} from '@towing/api-contracts';

/**
 * W11's commission screen, against the seeded launch rates: bands A 10 / B 8 /
 * C 5 inside the 5–10 window, one OPEN proposal from Operations for Band B, and
 * two history rows so the trail renders without a write.
 */
export const adminCommissionConfigMock: AdminCommissionConfig = {
  bands: [
    { band: 'A', pct: 10, updatedAt: '2026-09-01T04:00:00.000Z', updatedBy: null },
    { band: 'B', pct: 8, updatedAt: '2026-09-01T04:00:00.000Z', updatedBy: null },
    { band: 'C', pct: 5, updatedAt: '2026-09-01T04:00:00.000Z', updatedBy: null },
  ],
  floorPct: 5,
  capPct: 10,
  guardrailUpdatedAt: '2026-09-01T04:00:00.000Z',
};

export const adminCommissionHistoryMock: CommissionHistoryEntry[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    band: 'A',
    oldPct: 10,
    newPct: 9.5,
    changedBy: '00000000-0000-4000-8000-0000000000f1',
    reason: 'Festive season retention',
    createdAt: '2026-09-10T06:30:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    band: 'C',
    oldPct: null,
    newPct: 5,
    changedBy: '00000000-0000-4000-8000-0000000000f1',
    reason: 'Seeded launch default (§3.3)',
    createdAt: '2026-09-01T04:00:00.000Z',
  },
];

export const adminCommissionProposalsMock: AdminCommissionProposal[] = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    band: 'B',
    pct: 7.5,
    proposedBy: '00000000-0000-4000-8000-000000000011',
    reason: 'Driver supply is strong this month',
    status: 'open',
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-18T09:15:00.000Z',
  },
];
