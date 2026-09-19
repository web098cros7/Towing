import type {
  AdminPricingConfig,
  AdminPricingHistoryEntry,
  AdminPricingRule,
  AdminPricingRuleCreate,
  AdminPricingRuleDeactivate,
  AdminPricingUpdate,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  adminPricingConfigMock,
  adminPricingHistoryMock,
} from '../mocks/adminPricing.mock';

/**
 * W10's `/admin/pricing`. Every write is a PARTIAL by construction: the update
 * takes only the fields the operator changed, and create/deactivate are whole
 * rows. Nothing here ever sends a resolved matrix back, because
 * `adminPricingUpdateSchema` is all-optional with no defaults for exactly that
 * reason — a one-key PUT that arrives as every key would rewrite the fare table.
 */
export interface AdminPricingDataSource {
  config(): Promise<AdminPricingConfig>;
  update(patch: AdminPricingUpdate): Promise<AdminPricingConfig>;
  createRule(rule: AdminPricingRuleCreate): Promise<AdminPricingRule>;
  deactivateRule(ruleId: string, body: AdminPricingRuleDeactivate): Promise<AdminPricingRule>;
  history(): Promise<AdminPricingHistoryEntry[]>;
}

/**
 * Mocks APPLY config edits to a module-local copy, so the page behaves like the
 * page: a saved price stays saved while you edit the next row. (The finance
 * policy tab set that precedent.) Nothing in a mocks-on spec asserts a mutation
 * — the round trip is `e2e-live/`'s job — so this copy exists for the operator
 * previewing the console, not for the suite.
 */
let mockConfig: AdminPricingConfig = adminPricingConfigMock;

const mockSource: AdminPricingDataSource = {
  config: () => resolveMock(env.mockAdminPricingState, mockConfig, {
    ...adminPricingConfigMock,
    rules: [],
  }),

  update: async (patch) => {
    await mockDelay();
    mockConfig = {
      charges: { ...mockConfig.charges, ...(patch.charges ?? {}) },
      rules: mockConfig.rules.map((rule) => {
        const edited = patch.rules?.find((entry) => entry.id === rule.id);
        return edited ? { ...rule, ...edited } : rule;
      }),
    };
    return mockConfig;
  },

  createRule: async (rule) => {
    await mockDelay();
    const created: AdminPricingRule = {
      id: `00000000-0000-4000-8000-${String(mockConfig.rules.length + 1).padStart(12, '0')}`,
      ruleKind: rule.ruleKind,
      serviceType: rule.serviceType ?? null,
      vehicleClass: rule.vehicleClass ?? null,
      maxKm: rule.maxKm ?? null,
      pricePaise: rule.pricePaise,
      priceMaxPaise: rule.priceMaxPaise ?? null,
      isActive: true,
    };
    mockConfig = { ...mockConfig, rules: [...mockConfig.rules, created] };
    return created;
  },

  deactivateRule: async (ruleId) => {
    await mockDelay();
    const retired = mockConfig.rules.find((rule) => rule.id === ruleId);
    if (!retired) throw new Error('Pricing rule not found');
    const updated = { ...retired, isActive: false };
    mockConfig = {
      ...mockConfig,
      rules: mockConfig.rules.map((rule) => (rule.id === ruleId ? updated : rule)),
    };
    return updated;
  },

  history: () => resolveMock(env.mockAdminPricingState, adminPricingHistoryMock, []),
};

const restSource: AdminPricingDataSource = {
  config: () => adminApiFetch<AdminPricingConfig>('pricing'),
  update: (patch) =>
    adminApiFetch<AdminPricingConfig>('pricing', { method: 'PUT', body: JSON.stringify(patch) }),
  createRule: (rule) =>
    adminApiFetch<AdminPricingRule>('pricing/rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    }),
  deactivateRule: (ruleId, body) =>
    adminApiFetch<AdminPricingRule>(`pricing/rules/${ruleId}/deactivate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  history: () => adminApiFetch<AdminPricingHistoryEntry[]>('pricing/history'),
};

export const adminPricingDataSource: AdminPricingDataSource = env.useMocks
  ? mockSource
  : restSource;
