import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, ScrollView, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePressablePrimitive } from '@towing/ui';
import { useTheme } from '@towing/theme';
import {
  MiBookingCard,
  MiButton,
  MiColorIcon,
  MiNavBar,
  MiScreen,
  MiText,
  mitowColors,
  mitowLayout,
  mitowRadii,
  type MiBookingCardMedia,
  type MiBookingCardProps,
  type MiStatusBadgeStatus,
} from '@/design';
import { ErrorCodes, TRIP_ISSUE_WINDOW_DAYS, tripIssueWindowOpen } from '@towing/api-contracts';
import { useBookings } from '@/features/bookings/api/bookings.queries';
import { ApiClientError } from '@/lib/api/errors';
import type { Booking } from '@/features/bookings/types';
import { useCreateSupportTicket } from '@/features/support/api/support.queries';
import { uploadSupportPhotos } from '@/features/support/api/uploadAttachments';
import { serviceTitle } from '@/features/services/data/serviceTitles';
import type { RootStackParamList } from '@/navigation/types';
import { areaOf } from '@/screens/booking/tracking/trackingDisplay';
import { formatPaise } from '@/utils/format';

/**
 * Figma 61 · Report an Issue (`297:3352`), route `ReportIssue`.
 *
 * "Submit Report" files a real support ticket through the W15 rail
 * (`useCreateSupportTicket`). The chosen issue chip maps to a ticket category,
 * the description becomes the ticket body, and any picked photos are uploaded
 * first (`uploadSupportPhotos`) and passed as attachment keys.
 *
 * DATA: `useBookings()` (`items: Booking[]`, newest first). The chosen trip is the one with
 * `bookingId` if given, else the newest booking. "Change" (`297:3522`) cycles to the next
 * booking in `items` (wrapping) — no picker is drawn (reported).
 *
 * The trip is shown with `MiBookingCard`, built the same way `BookingsScreen.tsx` builds it
 * (`cardFor`, `badgeFor`, `mediaFor`, `cardDateLabel` copied here). No `onPress` on the card.
 *
 * State: `issue` (one of the six chip labels or null; tapping the selected chip clears it),
 * `description` (max 500), `photos` (string[] of local uris, max 3).
 */

/** The six chips drawn in `297:3538`. */
const ISSUE_TYPES = [
  'Driver behaviour',
  'Late arrival',
  'Vehicle damage',
  'Payment or fare',
  'App problem',
  'Other',
] as const;

type IssueType = (typeof ISSUE_TYPES)[number];

/** The ticket category each chip files under. */
const ISSUE_CATEGORY: Record<IssueType, 'booking' | 'payment' | 'kyc' | 'app' | 'safety' | 'other'> = {
  'Driver behaviour': 'safety',
  'Late arrival': 'booking',
  'Vehicle damage': 'booking',
  'Payment or fare': 'payment',
  'App problem': 'app',
  Other: 'other',
};

const MAX_DESCRIPTION = 500;
const MAX_PHOTOS = 3;

/** The colour-icon box for a service that has no drawn card of its own. */
const MEDIA_ICON_SIZE = 50;

/**
 * Badge, from §5.1's ten statuses (`jobStatusSchema`), matching `BookingsScreen.tsx`:
 * - `completed` — `completed`, `paid` and `disputed`.
 * - `cancelled` — `cancelled` and `no_drivers_found`.
 * - `upcoming` — every other status.
 */
function badgeFor(status: Booking['status']): MiStatusBadgeStatus {
  if (status === 'completed' || status === 'paid' || status === 'disputed') return 'completed';
  if (status === 'cancelled' || status === 'no_drivers_found') return 'cancelled';
  return 'upcoming';
}

/**
 * The card's media, per the booked service — copied from `BookingsScreen.tsx` so a service
 * looks like itself on both screens.
 */
function mediaFor(slug: string | null | undefined): MiBookingCardMedia {
  switch (slug) {
    case 'flat_tyre':
      return { kind: 'tyre' };
    case 'fuel':
      return { kind: 'icon', name: 'jerry-can', size: MEDIA_ICON_SIZE };
    case 'battery':
      return { kind: 'icon', name: 'battery', size: MEDIA_ICON_SIZE };
    case 'lockout':
      return { kind: 'icon', name: 'lock', size: MEDIA_ICON_SIZE };
    case 'breakdown':
      return { kind: 'icon', name: 'wrench', size: MEDIA_ICON_SIZE };
    default:
      return { kind: 'tow' };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** A card's date as 33 draws it: "02 Mar 2025, 04:30 PM"; null for an unreadable instant. */
function cardDateLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = pad2(d.getDate());
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hour12 = pad2(d.getHours() % 12 || 12);
  const minutes = pad2(d.getMinutes());
  const meridiem = d.getHours() < 12 ? ' AM' : ' PM';
  return `${day} ${month} ${year}, ${hour12}:${minutes}${meridiem}`;
}

/** A booking as the card's props, keeping its id for the key. */
type CardModel = MiBookingCardProps & { id: string };

/**
 * A booking, as the card's props — copied from `BookingsScreen.tsx`'s `cardFor`.
 */
function cardFor(booking: Booking): CardModel {
  const status = badgeFor(booking.status);
  const from = areaOf(booking.originLabel);
  const to = areaOf(booking.destinationLabel);
  return {
    id: booking.id,
    status,
    date: cardDateLabel(booking.scheduledAt ?? booking.createdAt),
    title: serviceTitle(booking.serviceSlug),
    route: from && to ? `${from} \u2192 ${to}` : null,
    price: status === 'cancelled' ? '\u2014' : formatPaise(booking.farePaise),
    media: mediaFor(booking.serviceSlug),
  };
}

export function ReportIssueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ReportIssue'>>();
  const bookingId = route.params?.bookingId;
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  const { items: allBookings } = useBookings();
  const createTicket = useCreateSupportTicket();

  const [issue, setIssue] = useState<IssueType | null>(null);

  /**
   * The trips this report can be about: those that happened in the last
   * `TRIP_ISSUE_WINDOW_DAYS`, like Uber and Ola (Ehsan, 23 Sep). A safety
   * report ("Driver behaviour") can be about any trip at any time — the server
   * applies the same rule, and dating a trip by when it was booked for keeps
   * this list a day stricter than the server, never looser.
   */
  const items = useMemo(() => {
    if (issue && ISSUE_CATEGORY[issue] === 'safety') return allBookings;
    return allBookings.filter((trip) => tripIssueWindowOpen(trip.scheduledAt ?? trip.createdAt));
  }, [allBookings, issue]);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [changeIndex, setChangeIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Tracks whether we've already applied the initial `bookingId` match to `changeIndex`, so
   * later "Change" taps are not overridden when `items` re-renders.
   */
  const appliedInitialRef = useRef(false);

  useEffect(() => {
    appliedInitialRef.current = false;
  }, [bookingId]);

  useEffect(() => {
    if (appliedInitialRef.current) return;
    if (items.length === 0) return;
    if (bookingId) {
      const idx = items.findIndex((b) => b.id === bookingId);
      if (idx >= 0) {
        setChangeIndex(idx);
        appliedInitialRef.current = true;
        return;
      }
    }
    appliedInitialRef.current = true;
  }, [items, bookingId]);

  /**
   * The chosen trip: `changeIndex` is the single source of truth. When `items` first load (or
   * `bookingId` changes) and `bookingId` matches an item, `changeIndex` is set to that item's
   * index once. "Change" cycles through `items` (wrapping) via `changeIndex`.
   */
  const booking = useMemo<Booking | null>(() => {
    if (items.length === 0) return null;
    return items[changeIndex % items.length] ?? null;
  }, [items, changeIndex]);

  const card = useMemo(() => (booking ? cardFor(booking) : null), [booking]);

  const cycleBooking = useCallback(() => {
    setChangeIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0));
  }, [items.length]);

  const toggleIssue = useCallback((label: IssueType) => {
    setIssue((current) => (current === label ? null : label));
  }, []);

  const addPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    const uri = result.assets[0]?.uri;
    if (!uri) return;
    setPhotos((current) => (current.length < MAX_PHOTOS ? [...current, uri] : current));
  }, []);

  const removePhoto = useCallback((uri: string) => {
    setPhotos((current) => current.filter((p) => p !== uri));
  }, []);

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!issue || !description.trim()) return;
    setSubmitting(true);
    try {
      const trimmed = description.trim();
      const body = trimmed.length < 4 ? `${trimmed} (reported from the app)` : trimmed;
      const subject = booking ? `${issue} \u00b7 ${booking.reference}` : `${issue}`;
      const attachments = photos.length > 0 ? await uploadSupportPhotos(photos) : undefined;
      const result = await createTicket.mutateAsync({
        category: ISSUE_CATEGORY[issue],
        subject,
        body,
        bookingId: booking?.id,
        attachments,
      });
      Alert.alert(
        'Report sent',
        `We've logged ${result.reference}. Our team will get back to you soon.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.code === ErrorCodes.TRIP_ISSUE_WINDOW_CLOSED) {
        Alert.alert(
          'This trip is too old to report',
          `Problems with a trip can be reported for ${TRIP_ISSUE_WINDOW_DAYS} days after it. ` +
            'For anything else, write to us from Help Center.',
        );
        return;
      }
      Alert.alert('Could not send your report', 'Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, issue, description, booking, photos, createTicket, navigation]);

  const canSubmit = Boolean(issue) && description.trim().length > 0 && !submitting;

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(insets.bottom, 43),
          }}
        >
          <MiButton
            tone="dark"
            label="Submit Report"
            onPress={submit}
            disabled={!canSubmit}
            loading={submitting}
          />
        </View>
      }
    >
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: 24,
        }}
      >
        {/* 1. Nav bar */}
        <MiNavBar title="Report an Issue" trailing="none" onBack={() => navigation.goBack()} />

        {/* 2. Trip `297:3519` */}
        <View style={{ gap: mitowLayout.headingGap }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <MiText variant="heading18">Which trip?</MiText>
            {items.length > 1 ? (
              <Pressable
                onPress={cycleBooking}
                hitSlop={10}
                pressScale={1}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel="Change trip"
              >
                <MiText variant="strong14" color="brand">
                  Change
                </MiText>
              </Pressable>
            ) : null}
          </View>
          {card ? (
            <MiBookingCard
              status={card.status}
              date={card.date}
              title={card.title}
              route={card.route}
              price={card.price}
              media={card.media}
            />
          ) : null}
        </View>

        {/* 3. What went wrong `297:3538` */}
        <View style={{ gap: mitowLayout.headingGap }}>
          <MiText variant="heading18">What went wrong?</MiText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ISSUE_TYPES.map((label) => {
              const selected = issue === label;
              return (
                <Pressable
                  key={label}
                  onPress={() => toggleIssue(label)}
                  pressScale={theme.motion.pressScale.row}
                  haptic="light"
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                >
                  <View
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: mitowRadii.pill,
                      borderWidth: 1.2,
                      borderColor: selected ? mitowColors.brandYellow : mitowColors.borderSubtle,
                      backgroundColor: selected
                        ? mitowColors.brandYellowSoft
                        : mitowColors.surfacePage,
                    }}
                  >
                    <MiText variant="strong14" color={selected ? 'brand' : 'primary'}>
                      {label}
                    </MiText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 4. Describe the issue `297:3553` (Figma Text Area `281:1717`) */}
        <View style={{ gap: 8 }}>
          <MiText variant="medium16">Describe the issue</MiText>
          <View
            style={{
              height: 124,
              borderRadius: 14,
              borderWidth: focused ? 1.5 : 1.2,
              borderColor: focused ? mitowColors.brandYellow : mitowColors.borderSubtle,
              backgroundColor: mitowColors.surfacePage,
              paddingTop: 12.8,
              paddingHorizontal: 12.8,
              paddingBottom: 10.8,
              justifyContent: 'space-between',
            }}
          >
            <TextInput
              multiline
              textAlignVertical="top"
              style={{
                flex: 1,
                fontSize: 15,
                lineHeight: 20,
                letterSpacing: -0.225,
                color: mitowColors.textPrimary,
                fontFamily: theme.fonts.regular,
                padding: 0,
              }}
              maxLength={MAX_DESCRIPTION}
              value={description}
              onChangeText={setDescription}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Tell us what happened…"
              placeholderTextColor={mitowColors.textPlaceholder}
              accessibilityLabel="Describe the issue"
            />
            <MiText variant="label13" color="placeholder" align="right">
              {`${description.length}/${MAX_DESCRIPTION}`}
            </MiText>
          </View>
        </View>

        {/* 5. Photos `297:3558` */}
        <View style={{ gap: mitowLayout.headingGap }}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <MiText variant="medium16">Add photos</MiText>
            <MiText variant="bodyM15" color="secondary">
              (optional)
            </MiText>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {photos.map((uri) => (
              <Pressable
                key={uri}
                onPress={() => removePhoto(uri)}
                pressScale={theme.motion.pressScale.row}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <Image source={{ uri }} style={{ width: 76, height: 76, borderRadius: 12 }} />
              </Pressable>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable
                onPress={() => void addPhoto()}
                pressScale={theme.motion.pressScale.row}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel="Add photo"
              >
                <View
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                    borderColor: mitowColors.borderHandle,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                  }}
                >
                  <MiColorIcon name="add-photo" size={28} />
                  <MiText variant="label13" color="secondary">
                    Add
                  </MiText>
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </MiScreen>
  );
}
