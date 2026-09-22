import type {
  SubjectNotificationPrefs,
  SubjectNotificationPrefsUpdate,
} from '@towing/api-contracts';
import { env } from '@/lib/env';
import { notificationPrefsMockSource } from './notificationPrefsMockSource';
import { notificationPrefsRestSource } from './notificationPrefsRestSource';

/**
 * §12.3 per-subject opt-outs for the driver.
 *
 * `GET`/`PUT driver/notification-prefs` have existed since Phase 13 with no
 * caller — the route's own comment says it shipped ahead of the screen so that
 * the driver-facing surface would be a screen rather than a screen plus an API
 * whenever TowPartner got round to it. This is that screen's half.
 */
export interface NotificationPrefsDataSource {
  get(): Promise<SubjectNotificationPrefs>;
  update(patch: SubjectNotificationPrefsUpdate): Promise<SubjectNotificationPrefs>;
}

export const notificationPrefsDataSource: NotificationPrefsDataSource = env.useMocks
  ? notificationPrefsMockSource
  : notificationPrefsRestSource;
