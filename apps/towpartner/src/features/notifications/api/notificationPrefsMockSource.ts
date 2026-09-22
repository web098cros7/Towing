import {
  SUBJECT_NOTIFICATION_PREF_DEFAULTS,
  type SubjectNotificationPrefs,
  type SubjectNotificationPrefsUpdate,
} from '@towing/api-contracts';
import type { NotificationPrefsDataSource } from './notificationPrefsDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Remembers what was set, so a toggle flipped in mock mode stays flipped when
 * the screen is reopened — the server merges a partial, and a mock that reset
 * on every read would hide a merge bug rather than show it.
 */
let prefs: SubjectNotificationPrefs = { ...SUBJECT_NOTIFICATION_PREF_DEFAULTS };

export const notificationPrefsMockSource: NotificationPrefsDataSource = {
  async get(): Promise<SubjectNotificationPrefs> {
    await delay(300);
    return { ...prefs };
  },

  async update(patch: SubjectNotificationPrefsUpdate): Promise<SubjectNotificationPrefs> {
    await delay(300);
    prefs = { ...prefs, ...patch };
    return { ...prefs };
  },
};
