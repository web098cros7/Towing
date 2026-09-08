import { apiFetch } from '@/lib/apiClient';
import { env } from '@/lib/env';
import { mockDelay } from '@/lib/mockUtils';
import { settingsMock, settingsOnboardingMock } from '../mocks/settings.mock';
import type { FleetSettings, OnboardingStep, PayoutAccountLink, SettingsUpdate } from '../types';

export interface SettingsDataSource {
  get(): Promise<FleetSettings>;
  update(patch: SettingsUpdate): Promise<FleetSettings>;
  linkPayoutAccount(input: PayoutAccountLink, idempotencyKey: string): Promise<FleetSettings>;
  unlinkPayoutAccount(): Promise<FleetSettings>;
  advanceOnboarding(from: OnboardingStep): Promise<FleetSettings>;
}

const STEP_ORDER: OnboardingStep[] = ['profile', 'payout_account', 'notifications', 'done'];

/**
 * The mock keeps its state in a module-level object so a save is visible on the
 * next read — a settings screen whose "Saved" message is followed by the old
 * values is worse than no mock at all.
 */
let mockState: FleetSettings =
  env.mockSettingsState === 'empty' ? settingsOnboardingMock : settingsMock;

const mockSource: SettingsDataSource = {
  get: async () => {
    await mockDelay();
    if (env.mockSettingsState === 'error') throw new Error('Mock error state (forced via env)');
    return mockState;
  },
  update: async (patch) => {
    await mockDelay();
    mockState = {
      ...mockState,
      businessName: patch.businessName ?? mockState.businessName,
      gstin: patch.gstin === undefined ? mockState.gstin : patch.gstin,
      address: patch.address === undefined ? mockState.address : patch.address,
      notificationPrefs: { ...mockState.notificationPrefs, ...patch.notificationPrefs },
    };
    const complete = Boolean(mockState.businessName?.trim() && mockState.address?.trim());
    mockState = {
      ...mockState,
      onboarding: {
        ...mockState.onboarding,
        profileComplete: complete,
        completedAt: mockState.onboarding.completedAt ?? (complete ? new Date().toISOString() : null),
      },
    };
    return mockState;
  },
  linkPayoutAccount: async (input) => {
    await mockDelay();
    mockState = {
      ...mockState,
      payoutAccount: {
        status: 'active',
        beneficiaryName: input.beneficiaryName,
        accountNumberLast4: input.accountNumber.slice(-4),
        ifsc: input.ifsc,
        bankName: 'Mock Bank',
        failureReason: null,
        linkedAt: new Date().toISOString(),
      },
      onboarding: { ...mockState.onboarding, payoutAccountLinked: true },
    };
    return mockState;
  },
  unlinkPayoutAccount: async () => {
    await mockDelay();
    mockState = {
      ...mockState,
      payoutAccount: {
        status: 'unlinked',
        beneficiaryName: null,
        accountNumberLast4: null,
        ifsc: null,
        bankName: null,
        failureReason: null,
        linkedAt: null,
      },
      onboarding: { ...mockState.onboarding, payoutAccountLinked: false },
    };
    return mockState;
  },
  advanceOnboarding: async (from) => {
    await mockDelay();
    const next = STEP_ORDER[STEP_ORDER.indexOf(from) + 1] ?? 'done';
    mockState = { ...mockState, onboarding: { ...mockState.onboarding, step: next } };
    return mockState;
  },
};

const restSource: SettingsDataSource = {
  get: () => apiFetch<FleetSettings>('settings'),
  // PUT with a partial body — the same idiom `PUT /fleet/trucks/:id` uses, which
  // is why the BFF proxy still needs no PATCH export.
  update: (patch) =>
    apiFetch<FleetSettings>('settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  linkPayoutAccount: (input, idempotencyKey) =>
    apiFetch<FleetSettings>('settings/payout-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  unlinkPayoutAccount: () =>
    apiFetch<FleetSettings>('settings/payout-account', { method: 'DELETE' }),
  advanceOnboarding: (from) =>
    apiFetch<FleetSettings>('settings/onboarding/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from }),
    }),
};

export const settingsDataSource: SettingsDataSource = env.useMocks ? mockSource : restSource;
