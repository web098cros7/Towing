import React, { useCallback, useRef } from 'react';
import { Alert, Linking, ScrollView, Share, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  MiInfoBanner,
  MiMapButton,
  MiNavBar,
  MiScreen,
  MiSupportCard,
  MiText,
  mitowLayout,
} from '@/design';
import { useEmergencyContacts } from '@/features/account/api/emergencyContacts.queries';
import { useSupportContact } from '@/features/app-config/appConfig';
import { useActiveBooking } from '@/features/bookings/api/bookings.queries';
import { useLocationStore } from '@/features/location/locationStore';
import { cancelSos, sendSos } from '@/features/sos/sos';
import { useShareTrip } from '@/features/tracking/api/tracking.queries';
import { track } from '@/lib/analytics/analytics';
import type { RootStackParamList } from '@/navigation/types';
import { EMERGENCY_NUMBERS, dial, mapsLink, smsUrl } from './emergency.data';
import { QuickActionTile } from './QuickActionTile';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Emergency alert 254:1337: vertical sizing FIXED at 106. */
const ALERT_HEIGHT = 106;
/** Tip 254:1443: vertical sizing FIXED at 62. */
const TIP_HEIGHT = 62;
/** Emergency numbers row 254:1347: gap between the three tiles. */
const TILE_GAP = 10;
/**
 * The tiles are 143 tall inside the row frame's FIXED 132, which does not clip.
 * The next block is placed from the frame's 132 plus the column gap 16, so it
 * starts 5 below the tiles (Figma, confirmed on the 3x render). A negative
 * bottom margin of 143 − 132 reproduces that 5.
 */
const TILE_OVERHANG = 11;
/** Contacts 254:1392: gap 8 between the three cards (not 58's 10). */
const CONTACTS_GAP = 8;
/**
 * The frame keeps 61 of white below the Tip on the 852 frame, 34 of it the
 * home-indicator zone: 27 + the bottom inset.
 */
const BOTTOM_GAP = 27;
/**
 * The one message for both actions, with the trip link: the app's existing share
 * copy (20 Booking Details), for consistency. Figma draws none.
 */
const tripMessage = (url: string) => `Follow my tow live: ${url}`;
/**
 * Without a trip: a one-off map link to the last known location. Not in Figma
 * (DATA-GAPS-26).
 */
const locationMessage = (url: string) => `My location: ${url}`;

/**
 * The longest Share or Notify waits on the network. `busy` is released only
 * once the awaited call settles, and the API client has no timeout of its own,
 * so a request that never settles would otherwise disable both actions for good.
 * The share-link mint is idempotent on the server, so a later tap that mints
 * again is safe.
 */
const NETWORK_TIMEOUT_MS = 10_000;

/** `promise`, or a rejection once `ms` has passed without it settling. */
function withTimeout<T>(promise: Promise<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * What Share and Notify send: the message, its link, and whether it is the
 * trip's §11.7 link (only that one, sent from the share sheet, is tracked as
 * `trip_shared`).
 */
type LiveLink = { message: string; url: string; trip: boolean };

/**
 * The failure alerts. Figma draws no failure state for 26, but on this screen a
 * tap that does nothing reads as "help was sent", so every failure says so in a
 * system alert and points at a way that still works.
 */
const NO_LOCATION = ['Location unavailable', 'Turn on location and try again.'] as const;
const SHARE_FAILED = [
  "Couldn't share your location",
  'Check your connection and try again, or call 112.',
] as const;
const CONTACTS_FAILED = [
  "Couldn't load your emergency contacts",
  'Check your connection and try again, or call 112.',
] as const;

/**
 * The SOS call AND the messages-app fallback both failed, so nobody has been
 * told. Offers the two calls that need no network: 112 and the contact.
 */
function alertNotifyFailed(contact: { name: string; phone: string }) {
  Alert.alert(`Couldn't alert ${contact.name}`, `Call them on ${contact.phone}, or call 112.`, [
    { text: 'Call 112', onPress: () => dial(EMERGENCY_NUMBERS.unified) },
    { text: `Call ${contact.name}`, onPress: () => dial(contact.phone) },
    { text: 'OK', style: 'cancel' },
  ]);
}

/**
 * Figma 26 · Emergency (`253:1212`). ROOT route `Emergency { bookingId? } | undefined`,
 * signed-in only; a pushed screen with a back chevron, no tab bar, no Help chip.
 * Opened from 25 Trip in Progress's Help chip with the trip's `bookingId`; without
 * it the screen falls back to the active booking. Everything scrolls in one column
 * (Content 254:1330: padding L/R 21, gap 16). Top to bottom: nav bar, the "Need
 * Immediate Help?" alert, three Quick Action Tiles, the Share My Live Location card,
 * "Other Quick Contacts" with three cards, the Tip. The screen draws ONE state; no
 * loading, failure or confirmation state is drawn, so every failure is a system
 * alert (a silent tap here would read as "help was sent"), and every action
 * ignores repeat taps while one is running. Notify posts the SOS; the server
 * alerts the safety desk and messages the contact.
 */
export function EmergencyScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const routeBookingId = useRoute<RouteProp<RootStackParamList, 'Emergency'>>().params?.bookingId;
  // The trip to share: the one 25 passed, else the booking in flight (if any). The
  // bookings feed is fetched only when no trip was passed.
  const { booking: activeBooking } = useActiveBooking({ enabled: !routeBookingId });
  const tripId = routeBookingId ?? activeBooking?.id ?? null;
  // The hook needs an id even when there is no trip; it is only called with one.
  const { mutateAsync: mintShareLink } = useShareTrip(tripId ?? '');
  // Loaded on mount so Notify knows at tap time whether a contact is saved.
  const { data: contacts, refetch: refetchContacts } = useEmergencyContacts();
  const { phoneDial, phoneDisplay } = useSupportContact();
  // One action at a time: Share and Notify ignore taps while one is running
  // (at most `NETWORK_TIMEOUT_MS` per network call, so a hung request cannot
  // lock them).
  const busy = useRef(false);

  /** Back chevron: to whatever pushed 26 (owner decision). */
  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  /**
   * The link Share and Notify send. With a trip: the §11.7 share link that 20's
   * "Share Live Location" mints. Without one: a Google Maps link to the last device
   * fix in the location store; null when the store has never had one (its initial
   * pickup is a built-in default, not the user's location).
   */
  const liveLink = useCallback(async (): Promise<LiveLink | null> => {
    if (tripId) {
      const link = await withTimeout(mintShareLink());
      return { message: tripMessage(link.url), url: link.url, trip: true };
    }
    const { pickup } = useLocationStore.getState();
    if (pickup === useLocationStore.getInitialState().pickup || !pickup.coords) return null;
    const url = mapsLink(pickup.coords);
    return { message: locationMessage(url), url, trip: false };
  }, [mintShareLink, tripId]);

  /**
   * Share My Live Location (254:1369): the link through the phone's share sheet, as
   * 20 does. No SOS backend exists, so it alerts nobody by itself.
   */
  const onShareLocation = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const link = await liveLink();
      if (!link) {
        Alert.alert(...NO_LOCATION);
        return;
      }
      const result = await Share.share({ message: link.message, url: link.url });
      // Counted only when the sheet reports a share: iOS resolves a dismissed sheet
      // with `dismissedAction` (Android always reports `sharedAction`).
      if (link.trip && result.action === Share.sharedAction) track('trip_shared');
    } catch {
      // A failed mint, a timeout or a share sheet that fails to open.
      Alert.alert(...SHARE_FAILED);
    } finally {
      busy.current = false;
    }
  }, [liveLink]);

  /** MiTow Support (409:18846): dials the number the card shows (owner decision). */
  const onCallSupport = useCallback(() => {
    if (phoneDial) dial(phoneDial);
  }, [phoneDial]);

  /**
   * Notify Emergency Contact (254:1426). No contact saved: 52 Add Emergency Contact.
   * Otherwise: get a position, POST the SOS (the server alerts MiTow's safety desk
   * AND messages the contact by SMS/WhatsApp), then confirm with an Undo that
   * cancels within `SOS_UNDO_WINDOW_SECONDS`. If the SOS call itself fails, fall
   * back to the phone's messages app with the same link as Share, as before.
   */
  const onNotifyContact = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      // Not loaded yet: load it now. `refetch` resolves (never throws) on a failed
      // load, with no data.
      const list = contacts ?? (await withTimeout(refetchContacts())).data;
      if (!list) {
        Alert.alert(...CONTACTS_FAILED);
        return;
      }
      const contact = list[0];
      if (!contact) {
        navigation.navigate('AddEmergencyContact');
        return;
      }

      // Get a position: last known first, then a fresh fix. Permission denied or
      // no fix at all: fall back to the pickup coords the screen already reads.
      let coords: { latitude: number; longitude: number; accuracy?: number | null } | null = null;
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status === 'granted') {
          const last = await Location.getLastKnownPositionAsync();
          const pos = last ?? (await Location.getCurrentPositionAsync());
          if (pos) {
            coords = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            };
          }
        }
      } catch {
        // Fall through to the pickup coords below.
      }
      if (!coords) {
        const { pickup } = useLocationStore.getState();
        if (pickup.coords) {
          coords = {
            latitude: pickup.coords.latitude,
            longitude: pickup.coords.longitude,
          };
        }
      }
      if (!coords) {
        Alert.alert('Location unavailable', 'Turn on location and try again.');
        return;
      }

      try {
        const result = await sendSos({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracyM: coords.accuracy ?? undefined,
          bookingId: tripId ?? undefined,
        });
        Alert.alert(
          'Help is on the way',
          `We've alerted ${contact.name} and MiTow's safety team with your location.`,
          [
            {
              text: 'Undo',
              style: 'destructive',
              onPress: () => void cancelSos(result.alertId),
            },
            { text: 'OK' },
          ],
        );
      } catch {
        // SOS call failed: fall back to the messages app with the Share link. If
        // that fails too (no link, a failed mint, no messages app), nobody has
        // been told, and the alert says so.
        try {
          const link = await liveLink();
          if (!link) throw new Error('no link');
          // No `trip_shared` here: this only opens the messages app with a draft, and
          // the app cannot tell whether the customer pressed Send.
          await Linking.openURL(smsUrl(contact.phone, link.message));
        } catch {
          alertNotifyFailed(contact);
        }
      }
    } catch {
      // The contacts load timed out.
      Alert.alert(...CONTACTS_FAILED);
    } finally {
      busy.current = false;
    }
  }, [contacts, liveLink, navigation, refetchContacts, tripId]);

  return (
    <MiScreen edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        // Content 254:1330: padding L/R 21, gap 16; it scrolls on phones shorter than the
        // drawn 852.
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: BOTTOM_GAP + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Nav Bar 258:1450, Trailing=None: no Help chip; the empty 70 slot keeps the title
            centred. */}
        <MiNavBar title="Emergency" onBack={goBack} />

        {/* Emergency alert 254:1337: Info Banner 224:14, fill status/danger-soft, title in
            MiTow/Title 20, no chevron, fixed 106. Static: read as one element. */}
        <MiInfoBanner
          tone="danger"
          icon="siren"
          titleVariant="title20"
          height={ALERT_HEIGHT}
          title="Need Immediate Help?"
          subtitle="Your safety is our priority. Contact emergency services or share your live location."
          accessibilityLabel="Need Immediate Help? Your safety is our priority. Contact emergency services or share your live location."
        />

        {/* Emergency numbers 254:1347: three Quick Action Tiles. `stretch` gives all three the
            tallest tile's height (143 as drawn); content stays top-aligned. Not clipped: the tile
            shadows show. */}
        <View
          style={{
            flexDirection: 'row',
            gap: TILE_GAP,
            alignItems: 'stretch',
            marginBottom: -TILE_OVERHANG,
          }}
        >
          <QuickActionTile
            icon="call"
            title="Call 112"
            subtitle="Emergency Helpline"
            accessibilityLabel="Call 112, Emergency Helpline"
            onPress={() => dial(EMERGENCY_NUMBERS.unified)}
          />
          <QuickActionTile
            icon="police"
            title="Call Police"
            subtitle={EMERGENCY_NUMBERS.police}
            accessibilityLabel={`Call Police, ${EMERGENCY_NUMBERS.police}`}
            onPress={() => dial(EMERGENCY_NUMBERS.police)}
          />
          <QuickActionTile
            icon="ambulance"
            title="Call Ambulance"
            subtitle={EMERGENCY_NUMBERS.ambulance}
            accessibilityLabel={`Call Ambulance, ${EMERGENCY_NUMBERS.ambulance}`}
            onPress={() => dial(EMERGENCY_NUMBERS.ambulance)}
          />
        </View>

        {/* Share My Live Location 254:1369: Menu Card with fill surface/muted and its stroke,
            effect and trailing chevron removed (the Row `I254:1369;253:1138` has no trailing
            layer); the icon slot holds a Map Control 223:24 at 34 with icon/navigation 24.
            Drawn `decorative` (a plain View, hidden from assistive tech), so the CARD takes the
            tap and carries the label. */}
        <MiSupportCard
          surface="muted"
          shadow="none"
          showChevron={false}
          leading={<MiMapButton decorative icon="navigation" size={34} iconSize={24} />}
          title="Share My Live Location"
          subtitle="Alerts your emergency contacts"
          accessibilityLabel="Share My Live Location. Alerts your emergency contacts"
          onPress={() => void onShareLocation()}
        />

        {/* Other quick contacts 254:1390: the section title, gap 12, then the three cards. */}
        <View style={{ gap: mitowLayout.headingGap }}>
          <MiText variant="heading18" accessibilityRole="header">
            Other Quick Contacts
          </MiText>
          <View style={{ gap: CONTACTS_GAP }}>
            <MiSupportCard
              icon="fire"
              shadow="cardSm"
              title="Call Fire Brigade"
              subtitle={EMERGENCY_NUMBERS.fire}
              accessibilityLabel={`Call Fire Brigade, ${EMERGENCY_NUMBERS.fire}`}
              onPress={() => dial(EMERGENCY_NUMBERS.fire)}
            />
            {/* MiTow Support 409:18846 (a detached copy of the same card). Figma's "+91 98765
                43210" is a sample: the card shows and dials the app's support line. */}
            {/* Only with a real support number: never a made-up line in an emergency. */}
            {phoneDisplay ? (
              <MiSupportCard
                icon="tow-truck"
                shadow="cardSm"
                title="MiTow Support"
                subtitle={phoneDisplay}
                accessibilityLabel={`MiTow Support, ${phoneDisplay}`}
                onPress={onCallSupport}
              />
            ) : null}
            <MiSupportCard
              icon="contact-alert"
              title="Notify Emergency Contact"
              subtitle="Share your trip and live location"
              accessibilityLabel="Notify Emergency Contact. Share your trip and live location"
              onPress={() => void onNotifyContact()}
            />
          </View>
        </View>

        {/* Tip 254:1443: Info Banner, fill surface/muted, no chevron, fixed 62. It has NO title
            layer, so no title is passed. Static text, not pressable. */}
        <MiInfoBanner
          tone="muted"
          icon="lightbulb"
          height={TIP_HEIGHT}
          subtitle="Tip: You can also share your live trip with a trusted contact from trip settings."
          accessibilityLabel="Tip: You can also share your live trip with a trusted contact from trip settings."
        />
      </ScrollView>
    </MiScreen>
  );
}
