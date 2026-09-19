import type {
  AdminCommissionConfig,
  AdminCommissionGuardrailUpdate,
  AdminCommissionImpact,
  AdminCommissionProposal,
  AdminCommissionProposalCreate,
  AdminCommissionProposalDecision,
  AdminCommissionUpdate,
  CommissionHistoryEntry,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  adminCommissionConfigMock,
  adminCommissionHistoryMock,
  adminCommissionProposalsMock,
} from '../mocks/adminCommission.mock';

/**
 * W11's `/admin/commission`: the band editor, the guardrail (decision G2), the
 * impact preview and §4.2's propose flow.
 *
 * Every write is a partial or a single row — the band update carries only the
 * bands the operator changed, and the guardrail update is its own route because
 * it is a different permission (`commission.guardrail`, Super Admin only).
 */
export interface AdminCommissionDataSource {
  config(): Promise<AdminCommissionConfig>;
  updateBands(body: AdminCommissionUpdate): Promise<AdminCommissionConfig>;
  updateGuardrail(body: AdminCommissionGuardrailUpdate): Promise<AdminCommissionConfig>;
  impact(bands: string, days: number): Promise<AdminCommissionImpact>;
  history(): Promise<CommissionHistoryEntry[]>;
  proposals(): Promise<AdminCommissionProposal[]>;
  createProposal(body: AdminCommissionProposalCreate): Promise<AdminCommissionProposal>;
  applyProposal(id: string, body: AdminCommissionProposalDecision): Promise<AdminCommissionConfig>;
  declineProposal(id: string, body: AdminCommissionProposalDecision): Promise<void>;
}

/**
 * Mocks apply band/guardrail edits to a module-local copy (the finance-policy
 * and pricing precedents), so the page behaves like the page for the operator
 * previewing it. No mocks-on spec asserts a mutation.
 */
let mockConfig: AdminCommissionConfig = adminCommissionConfigMock;
let mockProposals: AdminCommissionProposal[] = [...adminCommissionProposalsMock];

const mockSource: AdminCommissionDataSource = {
  config: () => resolveMock(env.mockAdminCommissionState, mockConfig, mockConfig),

  updateBands: async (body) => {
    await mockDelay();
    mockConfig = {
      ...mockConfig,
      bands: mockConfig.bands.map((band) => {
        const edited = body.bands.find((entry) => entry.band === band.band);
        return edited
          ? { ...band, pct: edited.pct, updatedAt: new Date().toISOString() }
          : band;
      }),
    };
    return mockConfig;
  },

  updateGuardrail: async (body) => {
    await mockDelay();
    mockConfig = {
      ...mockConfig,
      floorPct: body.floorPct,
      capPct: body.capPct,
      guardrailUpdatedAt: new Date().toISOString(),
    };
    return mockConfig;
  },

  /**
   * The preview arithmetic runs on the SERVER because it reads real bookings;
   * the mock states its answer from the numbers the console is showing, which
   * is enough for the panel to render and for the client to be validated.
   */
  impact: async (bands, days) => {
    await mockDelay();
    const proposed = new Map(
      bands.split(',').map((pair) => {
        const [band, pct] = pair.split(':');
        return [band!, Number(pct)] as const;
      }),
    );
    const rows = mockConfig.bands.map((band) => {
      const proposedPct = proposed.get(band.band) ?? band.pct;
      const currentPaise = band.band === 'A' ? 420_000 : band.band === 'B' ? 96_000 : 12_000;
      const proposedPaise = Math.round((currentPaise * proposedPct) / band.pct);
      return {
        band: band.band,
        currentPct: band.pct,
        proposedPct,
        bookings: band.band === 'A' ? 14 : band.band === 'B' ? 4 : 2,
        currentPaise,
        proposedPaise,
        deltaPaise: proposedPaise - currentPaise,
      };
    });
    return {
      days,
      bands: rows,
      totalCurrentPaise: rows.reduce((sum, row) => sum + row.currentPaise, 0),
      totalProposedPaise: rows.reduce((sum, row) => sum + row.proposedPaise, 0),
      totalDeltaPaise: rows.reduce((sum, row) => sum + row.deltaPaise, 0),
    };
  },

  history: () => resolveMock(env.mockAdminCommissionState, adminCommissionHistoryMock, []),
  proposals: () => resolveMock(env.mockAdminCommissionState, mockProposals, []),

  createProposal: async (body) => {
    await mockDelay();
    const created: AdminCommissionProposal = {
      id: `00000000-0000-4000-8000-${String(mockProposals.length + 1).padStart(12, '0')}`,
      band: body.band,
      pct: body.pct,
      // The mock identity is `operations` (see `app/api/admin-session/route.ts`).
      proposedBy: '00000000-0000-4000-8000-000000000011',
      reason: body.reason,
      status: 'open',
      decidedBy: null,
      decidedAt: null,
      createdAt: new Date().toISOString(),
    };
    mockProposals = [created, ...mockProposals];
    return created;
  },

  applyProposal: async (id, body) => {
    await mockDelay();
    const proposal = mockProposals.find((entry) => entry.id === id);
    if (!proposal) throw new Error('Proposal not found');
    mockProposals = mockProposals.map((entry) =>
      entry.id === id
        ? { ...entry, status: 'applied', decidedAt: new Date().toISOString() }
        : entry,
    );
    mockConfig = {
      ...mockConfig,
      bands: mockConfig.bands.map((band) =>
        band.band === proposal.band ? { ...band, pct: proposal.pct } : band,
      ),
    };
    void body;
    return mockConfig;
  },

  declineProposal: async (id, body) => {
    await mockDelay();
    mockProposals = mockProposals.map((entry) =>
      entry.id === id
        ? { ...entry, status: 'declined', decidedAt: new Date().toISOString() }
        : entry,
    );
    void body;
  },
};

const restSource: AdminCommissionDataSource = {
  config: () => adminApiFetch<AdminCommissionConfig>('commission'),
  updateBands: (body) =>
    adminApiFetch<AdminCommissionConfig>('commission', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  updateGuardrail: (body) =>
    adminApiFetch<AdminCommissionConfig>('commission/guardrail', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  impact: (bands, days) =>
    adminApiFetch<AdminCommissionImpact>(
      `commission/impact?bands=${encodeURIComponent(bands)}&days=${days}`,
    ),
  history: () => adminApiFetch<CommissionHistoryEntry[]>('commission/history'),
  proposals: () => adminApiFetch<AdminCommissionProposal[]>('commission/proposals'),
  createProposal: (body) =>
    adminApiFetch<AdminCommissionProposal>('commission/proposals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  applyProposal: (id, body) =>
    adminApiFetch<AdminCommissionConfig>(`commission/proposals/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  declineProposal: (id, body) =>
    adminApiFetch<void>(`commission/proposals/${id}/decline`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const adminCommissionDataSource: AdminCommissionDataSource = env.useMocks
  ? mockSource
  : restSource;
