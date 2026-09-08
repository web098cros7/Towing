import type {
  FleetSettingsDto,
  FleetSettingsUpdate,
  NotificationPrefs,
  OnboardingStep,
  PayoutAccountLinkRequest,
  PayoutAccountDto,
} from '@towing/api-contracts';

export type FleetSettings = FleetSettingsDto;
export type SettingsUpdate = FleetSettingsUpdate;
export type PayoutAccount = PayoutAccountDto;
export type PayoutAccountLink = PayoutAccountLinkRequest;
export type { NotificationPrefs, OnboardingStep };

/** Labels for the four §9.3.1 preferences, in the order the card renders them. */
export const NOTIFICATION_PREF_LABELS: ReadonlyArray<{
  key: keyof NotificationPrefs;
  label: string;
  description: string;
}> = [
  {
    key: 'compliance',
    label: 'Compliance expiry alerts',
    description: 'Insurance, RC, PUC and permit expiries — 30 days ahead.',
  },
  {
    key: 'payouts',
    label: 'Payout status updates',
    description: 'When a payout is processed or fails.',
  },
  { key: 'jobs', label: 'New job notifications', description: 'Every job assigned to your fleet.' },
  { key: 'weekly', label: 'Weekly summary email', description: 'Earnings and utilization digest.' },
];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  profile: 'Business profile',
  payout_account: 'Bank account',
  notifications: 'Notifications',
  done: 'Done',
};
