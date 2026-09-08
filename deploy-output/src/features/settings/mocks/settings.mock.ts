import type { FleetSettings } from '../types';

/**
 * ⚠ `onboarding.step` defaults to `'done'`.
 *
 * `NEXT_PUBLIC_*` is inlined at `next build`, so mocks-on is a BUILD-time
 * property and there is only ever one build for the whole Playwright run. A
 * mock that started mid-wizard would show the onboarding banner on `/settings`
 * in every existing spec. `NEXT_PUBLIC_MOCK_SETTINGS_STATE=onboarding` is the
 * opt-in for previewing the wizard.
 */
export const settingsMock: FleetSettings = {
  businessName: 'Lakshmi Recovery Services',
  gstin: '29ABCDE1234F1Z5',
  address: '12, Industrial Layout, Bengaluru 560068',
  notificationPrefs: { compliance: true, payouts: true, jobs: false, weekly: true },
  payoutAccount: {
    status: 'active',
    beneficiaryName: 'Lakshmi Recovery Services',
    accountNumberLast4: '4021',
    ifsc: 'HDFC0000123',
    bankName: 'HDFC Bank',
    failureReason: null,
    linkedAt: new Date(Date.now() - 45 * 86_400_000).toISOString(),
  },
  onboarding: {
    step: 'done',
    profileComplete: true,
    payoutAccountLinked: true,
    completedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
  },
};

/** A fresh account, for previewing the §9.3.1 wizard. */
export const settingsOnboardingMock: FleetSettings = {
  businessName: 'New Recovery Co',
  gstin: null,
  address: null,
  notificationPrefs: { compliance: true, payouts: true, jobs: false, weekly: true },
  payoutAccount: {
    status: 'unlinked',
    beneficiaryName: null,
    accountNumberLast4: null,
    ifsc: null,
    bankName: null,
    failureReason: null,
    linkedAt: null,
  },
  onboarding: {
    step: 'profile',
    profileComplete: false,
    payoutAccountLinked: false,
    completedAt: null,
  },
};
