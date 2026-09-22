import Constants from 'expo-constants';
import { PermissionsAndroid, Platform } from 'react-native';
import type { DevicePlatform } from '@towing/api-contracts';

/**
 * Everything that touches `expo-notifications` natively, behind one module.
 *
 * ⚠ EVERY IMPORT HERE IS DEFERRED, for the same reason `lib/storage/storage.ts`
 * defers MMKV: `expo-notifications` is a native module, and a static import
 * would throw at module-load in Expo Go — taking the whole app down at the
 * splash screen rather than degrading to "push is unavailable here".
 *
 * ⚠ NOTHING IN THIS FILE HAS EVER RUN. No EAS or dev-client build exists for
 * this app, so no push token has ever been minted, no permission prompt has
 * ever been shown, and no notification has ever been received. Written against
 * the documented `expo-notifications` API and typechecked; not executed.
 */

export type PushAvailability =
  { available: true } | { available: false; reason: 'expo_go' | 'simulator' | 'module_missing' };

/** The three states the UI has to be able to explain to a user. */
export type PushPermission = 'granted' | 'denied' | 'undetermined';

type NotificationsModule = typeof import('expo-notifications');
type DeviceModule = typeof import('expo-device');

/**
 * True ONLY inside Expo Go — the one environment where `expo-notifications`
 * must not be loaded at all.
 *
 * ⚠ DELIBERATELY `appOwnership`, NOT `Constants.executionEnvironment`, even
 * though `appOwnership` carries a deprecation notice. `ExecutionEnvironment`
 * has no value that means "Expo Go": its `StoreClient` covers Expo Go AND a
 * dev-client build, and a dev client is precisely where push DOES work — it is
 * the first environment able to prove any of this code. Switching to the
 * "modern" check would therefore disable push exactly where we need it.
 * `appOwnership` returns 'expo' in Expo Go and null everywhere else, which is
 * the distinction this file actually needs.
 */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

function notificationsModule(): NotificationsModule | null {
  /*
   * ⚠ THE EXPO GO CHECK BELONGS HERE, BEFORE THE `require` — NOT AFTER IT.
   *
   * Deferring the import is not sufficient on its own. Since SDK 53, importing
   * `expo-notifications` inside Expo Go executes
   * `DevicePushTokenAutoRegistration.fx`, which calls `addPushTokenListener`
   * and emits the "removed from Expo Go" error at MODULE-LOAD time. It is
   * reported via `console.error`, so the try/catch below cannot intercept it —
   * LogBox renders it as a full-screen Uncaught Error and the app dies at the
   * splash screen.
   *
   * That is precisely the failure the deferred import was written to prevent,
   * reintroduced by testing for Expo Go one line too late. Observed 21 Aug
   * 2026 running the customer app in Expo Go.
   */
  if (isExpoGo()) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose; see the comment above
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

function deviceModule(): DeviceModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose; see the comment above
    return require('expo-device') as DeviceModule;
  } catch {
    return null;
  }
}

/**
 * Why a push token cannot be minted here, when it cannot.
 *
 * Surfaced rather than swallowed: a settings screen that silently shows
 * "notifications on" in Expo Go, where remote push does not work at all, is the
 * exact "looks finished in review" failure this phase is trying not to ship.
 */
export function pushAvailability(): PushAvailability {
  // FIRST, unconditionally. Remote push was removed from Expo Go in SDK 53 — a
  // dev-client or EAS build is required, and neither has ever been produced for
  // this app. Consulting `notificationsModule()` before this line is what
  // red-screened the app in Expo Go; see the note inside that function.
  if (isExpoGo()) return { available: false, reason: 'expo_go' };

  if (!notificationsModule()) return { available: false, reason: 'module_missing' };

  const device = deviceModule();
  // A simulator has no APNs/FCM registration to hand out.
  if (device && device.isDevice === false) return { available: false, reason: 'simulator' };

  return { available: true };
}

export async function getPermission(): Promise<PushPermission> {
  const notifications = notificationsModule();
  if (!notifications) return 'denied';

  const { status } = await notifications.getPermissionsAsync();
  return status as PushPermission;
}

/**
 * Asks the OS. Returns the resulting status rather than a boolean, because
 * `denied` and `undetermined` need different UI: one offers Settings, the other
 * offers the prompt again.
 */
export async function requestPermission(): Promise<PushPermission> {
  const notifications = notificationsModule();
  if (!notifications) return 'denied';

  const { status } = await notifications.requestPermissionsAsync();
  return status as PushPermission;
}

/**
 * Whether the OS notification prompt can be SHOWN here: a weaker question than
 * `pushAvailability()`, which asks whether a TOKEN can be minted. The priming
 * sheet (Figma 07) only needs this one: Expo Go and emulators can grant the
 * permission even though remote push cannot reach them.
 */
export function canRequestPermission(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  // See requestOsPermission for how each platform asks inside Expo Go.
  if (isExpoGo()) return true;
  return notificationsModule() !== null;
}

/**
 * Asks the OS for notification permission without ever loading
 * `expo-notifications` where loading it is fatal. Never throws.
 *
 * Expo Go on Android: expo-notifications 57 THROWS at module load there
 * (DevicePushTokenAutoRegistration.fx -> addPushTokenListener ->
 * warnOfExpoGoPushUsage), and Metro reports a throw from a runtime `require`
 * as fatal, so try/catch cannot save it. React Native's PermissionsAndroid asks
 * for the same POST_NOTIFICATIONS permission with no expo-notifications involved.
 */
export async function requestOsPermission(): Promise<PushPermission> {
  try {
    if (!isExpoGo()) return await requestPermission();

    if (Platform.OS === 'android') {
      // Below Android 13 notifications are on by default and there is no
      // runtime prompt; PermissionsAndroid would report the unknown permission
      // as denied.
      if (Number(Platform.Version) < 33) return 'granted';
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
    }

    // Expo Go on iOS: warnOfExpoGoPushUsage only console.warns there, so the
    // module loads. Used for the permission ONLY; notificationsModule() still
    // returns null in Expo Go, so no listener or token path changes.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred on purpose; see the comment above
    const notifications = require('expo-notifications') as NotificationsModule;
    const { status } = await notifications.requestPermissionsAsync();
    return status as PushPermission;
  } catch {
    return 'undetermined';
  }
}

/**
 * The Expo push token, or null when there is no way to get one.
 *
 * Needs the EAS project id: Expo's push service routes by it, and
 * `getExpoPushTokenAsync` throws without one. TowGo has an id in
 * `app.config.ts`; TowPartner does not yet (`ToBeDoneEhsan.md`).
 */
export async function getPushToken(): Promise<string | null> {
  const notifications = notificationsModule();
  if (!notifications) return null;
  if (!pushAvailability().available) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
  if (!projectId) return null;

  try {
    const token = await notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
    // A token failure must never break sign-in. The device registers with a
    // null token instead, and picks one up on a later attempt.
    return null;
  }
}

export function currentPlatform(): DevicePlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/**
 * Foreground presentation. Without this the OS shows nothing while the app is
 * open, and a notification that arrives during a session is simply lost.
 *
 * Deliberately no custom in-app toast: `shouldShowBanner` renders the OS banner
 * over the app already, and a second surface would double-render every message.
 */
export function configureForegroundPresentation(): void {
  const notifications = notificationsModule();
  if (!notifications) return;

  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Subscription handles, so callers can unsubscribe without importing the module. */
export interface PushSubscriptions {
  remove(): void;
}

export function addNotificationListeners(handlers: {
  onReceived: (data: Record<string, unknown>) => void;
  onTapped: (data: Record<string, unknown>) => void;
  onTokenChanged: (token: string) => void;
}): PushSubscriptions {
  const notifications = notificationsModule();
  if (!notifications) return { remove: () => {} };

  const received = notifications.addNotificationReceivedListener((event) => {
    handlers.onReceived(event.request.content.data ?? {});
  });
  const responded = notifications.addNotificationResponseReceivedListener((event) => {
    handlers.onTapped(event.notification.request.content.data ?? {});
  });
  const tokenChanged = notifications.addPushTokenListener((token) => {
    handlers.onTokenChanged(token.data);
  });

  return {
    remove: () => {
      received.remove();
      responded.remove();
      tokenChanged.remove();
    },
  };
}

/**
 * The notification that opened a killed app.
 *
 * `addNotificationResponseReceivedListener` only fires while the app is
 * running, so a cold start from a tap would otherwise land on the home screen
 * with the message silently dropped.
 */
export async function getInitialNotificationData(): Promise<Record<string, unknown> | null> {
  const notifications = notificationsModule();
  if (!notifications) return null;

  const response = await notifications.getLastNotificationResponseAsync();
  return response?.notification.request.content.data ?? null;
}
