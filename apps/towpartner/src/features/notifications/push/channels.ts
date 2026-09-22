import { Platform } from 'react-native';

import { isExpoGo } from './pushClient';

/**
 * THE HIGH-PRIORITY OFFER CHANNEL, created now and deliberately unused.
 *
 * Phase 17's `job:offer` gives a driver ~20 seconds to accept, and it has to
 * arrive when the app is backgrounded and the phone is in Doze — which is
 * exactly when a WebSocket is not connected and a normal-priority push is
 * batched until the next maintenance window. A channel created for the first
 * time on the day dispatch ships is a channel nobody has ever seen behave.
 *
 * ⚠ THE CHANNEL ID IS VERSIONED FOR A REASON. Android IGNORES every change to
 * an existing channel's importance, sound and vibration once it has been
 * created — the user owns those settings from that point on. So Phase 17 cannot
 * "add the distinct sound" to this channel; it has to create `job-offer-v2`
 * with the sound and stop using this one. Bump the suffix, never edit in place.
 *
 * `sound: 'default'` for now, because a distinct alert tone needs an actual
 * audio asset that has to be sourced and licensed (`ToBeDoneEhsan.md`). The
 * Doze bypass does NOT come from the sound — it comes from `importance: MAX`
 * plus `bypassDnd`, both of which are here — so the mechanism that matters is
 * already in place and testable.
 *
 * ⚠ NEVER EXECUTED. No build exists for this app, so this channel has never
 * been created on a device and neither its presentation nor its Doze behaviour
 * has been observed.
 */
export const JOB_OFFER_CHANNEL_ID = 'job-offer-v1';

const GENERAL_CHANNEL_ID = 'general-v1';

type NotificationsModule = typeof import('expo-notifications');

function notificationsModule(): NotificationsModule | null {
  // Same rule as `pushClient.ts`, and it matters just as much here: never
  // `require` this module in Expo Go, where importing it emits an
  // unrecoverable module-load error. `ensureNotificationChannels()` runs on
  // every Android launch, so without this guard the driver app red-screens on
  // startup as reliably as the customer app did.
  if (isExpoGo()) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose; see the comment above
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

/**
 * Android only — iOS has no channel concept; its equivalents are the
 * interruption level and the critical-alert entitlement, neither of which
 * Phase 13 needs.
 *
 * Safe and cheap to call on every launch: creating a channel that already
 * exists is a no-op.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const notifications = notificationsModule();
  if (!notifications) return;

  await notifications.setNotificationChannelAsync(GENERAL_CHANNEL_ID, {
    name: 'Updates',
    importance: notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
  });

  await notifications.setNotificationChannelAsync(JOB_OFFER_CHANNEL_ID, {
    name: 'Job offers',
    description: 'Alerts you when a job is offered. These are time-limited.',
    // MAX is what makes it a heads-up notification that can wake a dozing
    // device — HIGH is batched.
    importance: notifications.AndroidImportance.MAX,
    // A driver on Do Not Disturb still has to be reachable for a job they
    // chose to be online for.
    bypassDnd: true,
    // PUBLIC so the offer is readable without unlocking — the whole point is a
    // decision inside 20 seconds.
    lockscreenVisibility: notifications.AndroidNotificationVisibility.PUBLIC,
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    sound: 'default',
  });
}
