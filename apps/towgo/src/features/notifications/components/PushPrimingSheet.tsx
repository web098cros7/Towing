import React from 'react';
import { View } from 'react-native';
import { mitowColors, mitowRadii, MiButton, MiColorIcon, MiSheet, MiText } from '@/design';
import { track } from '@/lib/analytics/analytics';
import { storage } from '@/lib/storage/storage';
import {
  canRequestPermission,
  getPermission,
  getPushToken,
  requestOsPermission,
} from '../push/pushClient';
import { registerRotatedToken } from '../push/usePushRegistration';

const PRIMED_KEY = 'push.primed';

/**
 * Whether Figma 07 should slide over Home.
 *
 * Gated on whether the OS can be ASKED (`canRequestPermission`), not on whether
 * a push token can be minted: the sheet is part of the designed flow, so it
 * shows in Expo Go and on emulators too, where only the token is unavailable.
 */
export function shouldPrimePush(): boolean {
  if (!canRequestPermission()) return false;
  return storage.getString(PRIMED_KEY) !== 'true';
}

/**
 * Figma 07 · Turn On Notifications (`287:2083`): a one-time explanation shown
 * BEFORE the OS permission prompt ("Ask before the system prompt").
 *
 * The OS prompt can only be answered once per install, so it is spent on people
 * who already know what it is for. Marked primed on every exit ("Not now",
 * Android back, or after the OS answers), so it is asked once. RootNavigator
 * decides when it mounts (over Home, after consent).
 *
 * Sheet (MiSheet defaults = the design): Dim surface/inverse 45%, padding
 * 14 / 21 / 34, gap 16, 36 x 5 handle. The buttons are drawn plain: no spinner,
 * no dimmed state, so none is rendered; a ref blocks a double tap instead.
 */
export function PushPrimingSheet({ onDone }: { onDone: () => void }) {
  const done = React.useRef(false);
  const busy = React.useRef(false);

  const finish = React.useCallback(() => {
    if (done.current) return;
    done.current = true;
    try {
      // Marked primed on EITHER answer. The whole point is to ask once.
      storage.set(PRIMED_KEY, 'true');
    } finally {
      onDone();
    }
  }, [onDone]);

  const allow = React.useCallback(async () => {
    if (busy.current || done.current) return;
    busy.current = true;
    try {
      const status = await requestOsPermission();
      track(status === 'granted' ? 'push_permission_granted' : 'push_permission_denied');
      if (status === 'granted') {
        // Re-register immediately: the device row already exists with a null
        // token from sign-in, and this is the moment it can carry a real one.
        // getPushToken returns null in Expo Go and on a simulator without
        // touching expo-notifications there.
        const token = await getPushToken();
        if (token) await registerRotatedToken(token);
      }
    } catch {
      // A failed ask must never surface an error or trap the customer here.
    } finally {
      busy.current = false;
      finish();
    }
  }, [finish]);

  return (
    <MiSheet visible onClose={finish} accessibilityLabel="Turn on notifications">
      {/* 2. Icon circle 287:2086: 64, brand/yellow-soft, icon/color/bell 40. */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.brandYellowSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MiColorIcon name="bell" size={40} />
      </View>

      {/* 3. Heading group 287:2088: gap 6. */}
      <View style={{ gap: 6 }}>
        <MiText variant="title23" accessibilityRole="header">
          Know when your driver arrives
        </MiText>
        <MiText variant="bodyL155" color="secondary">
          {
            'We will let you know when a driver accepts your booking, when they are close, and when your payment goes through.'
          }
        </MiText>
      </View>

      {/* 4. Actions 287:2116: gap 10, both 54 tall, no icons. */}
      <View style={{ gap: 10 }}>
        <MiButton label="Turn on notifications" onPress={allow} />
        <MiButton label="Not now" tone="quiet" onPress={finish} />
      </View>
    </MiSheet>
  );
}

/** Exported for the settings screen, which shows the current state honestly. */
export async function currentPushPermission() {
  return getPermission();
}
