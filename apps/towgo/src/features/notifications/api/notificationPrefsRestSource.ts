import type {
  SubjectNotificationPrefs,
} from '@towing/api-contracts';
import { apiFetch } from '@/lib/api/client';
import type { NotificationPrefsDataSource } from './notificationPrefsDataSource';

export const notificationPrefsRestSource: NotificationPrefsDataSource = {
  get() {
    return apiFetch<SubjectNotificationPrefs>('me/notification-prefs');
  },

  update(patch) {
    // A genuine partial: the server merges, so sending one key must not blank
    // the others.
    return apiFetch<SubjectNotificationPrefs>('me/notification-prefs', {
      method: 'PUT',
      body: JSON.stringify(patch),
      idempotent: true,
    });
  },
};
