import type {
  SubjectNotificationPrefs,
  SubjectNotificationPrefsUpdate,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { NotificationPrefsDataSource } from './notificationPrefsDataSource';

export const notificationPrefsRestSource: NotificationPrefsDataSource = {
  get() {
    return apiFetch<SubjectNotificationPrefs>('driver/notification-prefs');
  },

  update(patch) {
    // A genuine partial: the server merges, so sending one key must not blank
    // the others.
    return apiFetch<SubjectNotificationPrefs>('driver/notification-prefs', {
      method: 'PUT',
      body: JSON.stringify(patch),
      idempotent: true,
    });
  },
};
