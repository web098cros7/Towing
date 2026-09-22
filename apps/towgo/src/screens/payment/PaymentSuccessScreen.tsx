import React, { useCallback } from 'react';
import { AccessibilityInfo, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiButton,
  MiCard,
  MiColorIcon,
  MiInfoBanner,
  MiLineIcon,
  MiScreen,
  MiServiceRow,
  MiSuccessMark,
  MiSummaryRow,
  MiText,
  mitowColors,
  mitowLayout,
} from '@/design';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { useBooking } from '@/features/bookings/api/bookings.queries';
import { PAYMENT_METHOD_LABEL } from '@/features/payments/labels';
import { serviceTitle } from '@/features/services/data/serviceTitles';
import { copyText } from '@/lib/clipboard';
import type { RootStackParamList } from '@/navigation/types';
import { displayDriver, vehicleModelLabel } from '@/screens/booking/tracking/trackingDisplay';
import { useBookingTracking } from '@/screens/bookings/booking-details/useBookingLive';
import { formatPaise } from '@/utils/format';
import { paidAtLabel } from './paymentDisplay';
import { RateTripSheet } from './rating/RateTripSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Actions `245:1087`: the lower button's bottom edge sits 34 above the 852 frame. */
const FOOTER_BOTTOM_GAP = 34;
/** Secure payment `245:1078`: the Info Banner instance's fixed height (the master is 67). */
const BANNER_HEIGHT = 71;
/** Service `245:1034`: the subtitle box of "Tata 407 (Flatbed)", for its placeholder bar. */
const VEHICLE_SLOT_WIDTH = 119;
/** Figma value boxes of 30's rows, for their placeholder bars. */
const DATE_SLOT_WIDTH = 159;
const TRANSACTION_SLOT_WIDTH = 123;

/**
 * Figma 30 · Payment Successful (`243:945`), root route `PaymentSuccess { bookingId, payment }`.
 * Reached only by a stack RESET to `[Tabs, PaymentSuccess]` once a capture comes back captured,
 * so Back (the chevron, Android back) can only reach Home, never 27 or Tracking; the route has
 * no back swipe.
 *
 * Content `245:1012` scrolls: the bare Back, the Success Mark, the title, the Payment details
 * card (Service Row, then Date & Time, Payment Method and Transaction ID as Summary Rows with
 * colour icons, 1-tall dividers between) and the green "Secure Payment" banner. Actions
 * `245:1087` is its own layer, so it is 58's pinned footer: "View Booking Details" (dark) over
 * "Book Another Tow" (outline), gap 12.
 *
 * DATA: the Service price is what was charged (`payment.amountPaise`, a coupon included); the
 * subtitle is the truck's make and model from the tracking payload; Date & Time, Payment Method
 * and Transaction ID are what the payment told the app (`payment`). The service title is the
 * booked service's name (`serviceTitle`, the words Home and 09 use); like any missing value, an
 * unknown one keeps a placeholder bar at its drawn width. No row is ever dropped.
 *
 * 31 · Rate Your Trip is NOT a screen any more: it is `RateTripSheet`, a modal sheet this screen
 * mounts, so 30 is always the screen behind it. See that file for when it opens.
 */
export function PaymentSuccessScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { bookingId, payment } = useRoute<RouteProp<RootStackParamList, 'PaymentSuccess'>>().params;
  const setServiceSlug = useBookingStore((s) => s.setServiceSlug);

  // No poll and no socket: the trip is settled. The tracking payload is read once, for the truck.
  const { data: booking } = useBooking(bookingId);
  const { data: tracking } = useBookingTracking(bookingId, true, false);

  const price = formatPaise(payment.amountPaise);
  const title = serviceTitle(booking?.serviceSlug);
  const vehicleModel = vehicleModelLabel(displayDriver(tracking));
  const paidAt = paidAtLabel(payment.paidAt);
  const methodLabel = PAYMENT_METHOD_LABEL[payment.method];
  const transactionId = payment.transactionId;

  /**
   * Back `245:1014`: Home, by popping to the tabs (the stack under 30 is only the tabs), as
   * Tracking's goHome does. v7's `navigate` would push a second Tabs over 30 instead. Android
   * back pops the same way.
   */
  const goHome = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  /** "View Booking Details": pushed over 30, so its Back returns here. */
  const openBooking = useCallback(() => {
    navigation.navigate('BookingDetails', { bookingId });
  }, [bookingId, navigation]);

  /**
   * "Book Another Tow": 10 Enter Location, Home's book-a-tow destination, as a reset so Back on
   * 10 goes Home rather than here. The service is set to a tow, since the store may still hold
   * the paid trip's roadside service (30 Decision E).
   */
  const bookAnother = useCallback(() => {
    setServiceSlug('car_tow');
    navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'BookLocation' }] });
  }, [navigation, setServiceSlug]);

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            gap: 12,
            // 58's pinned-bottom rule: exactly the drawn 34 on iPhone 16, and never under a
            // taller system navigation bar.
            paddingBottom: Math.max(insets.bottom, FOOTER_BOTTOM_GAP),
          }}
        >
          {/* View Booking Details `245:1088`: Primary Button, no icons. */}
          <MiButton tone="dark" label="View Booking Details" onPress={openBooking} />
          {/* Book Another Tow `245:1094`: Secondary Button Tone=Strong, no icon. */}
          <MiButton tone="outline" label="Book Another Tow" onPress={bookAnother} />
        </View>
      }
    >
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: mitowLayout.blockGap, // the banner never touches the pinned buttons when the column scrolls
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar onBack={goHome} />

        {/* Illustration `245:1017`: the Success Mark centred (its circle sits 2.3 left, as drawn). */}
        <View style={{ alignItems: 'center' }}>
          <MiSuccessMark />
        </View>

        {/* Title `245:1030`: gap 6, centred, each line on ONE line as drawn: on a narrow phone or a large system font the text shrinks (never below 80 %) instead of wrapping. */}
        <View style={{ gap: 6, alignItems: 'center' }}>
          <MiText
            variant="display27"
            align="center"
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            Payment Successful!
          </MiText>
          <MiText
            variant="bodyL155"
            color="secondary"
            align="center"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            Your payment has been processed successfully.
          </MiText>
        </View>

        {/*
          Payment details `245:1033`: padding 14 from the outer edge with the 1.2 stroke INSIDE
          and not in layout, so 12.8 here (RN's border takes layout space); gap 10; no heading.
        */}
        <MiCard radius={16} padding={12.8} gap={10}>
          <MiServiceRow
            title={title}
            subtitle={vehicleModel}
            subtitleSlotWidth={VEHICLE_SLOT_WIDTH}
            price={price}
          />
          <Divider />
          <MiSummaryRow
            icon={{ color: 'calendar' }}
            label="Date & Time"
            value={paidAt}
            valueSlotWidth={DATE_SLOT_WIDTH}
          />
          <Divider />
          <MiSummaryRow icon={{ color: 'card' }} label="Payment Method" value={methodLabel} />
          <Divider />
          <MiSummaryRow
            icon={{ color: 'receipt' }}
            label="Transaction ID"
            value={transactionId}
            valueSlotWidth={TRANSACTION_SLOT_WIDTH}
            trailing={<CopyButton value={transactionId} />}
          />
        </MiCard>

        {/* Secure payment `245:1078`: Info Banner with the success-soft fill and the green shield. */}
        <MiInfoBanner
          tone="success"
          icon="verified-success"
          height={BANNER_HEIGHT}
          title="Secure Payment"
          subtitle="Your payment information is always safe with us."
        />
      </ScrollView>

      {/* Figma 31 · Rate Your Trip: the modal sheet over this screen, not a screen of its own. */}
      <RateTripSheet bookingId={bookingId} driver={displayDriver(tracking)} />
    </MiScreen>
  );
}

/**
 * Top bar `245:1013`: NOT the Nav Bar (no title, no Help). One bare 46 × 46 Back frame, icon/
 * chevron-left 24 on the 21 margin, the whole box the hit area: 20's Header construction.
 */
function TopBar({ onBack }: { onBack: () => void }) {
  const Pressable = usePressablePrimitive();

  return (
    <View style={{ height: 46, flexDirection: 'row', alignItems: 'flex-start' }}>
      <Pressable
        onPress={onBack}
        pressScale={0.9}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={{ width: 46, height: 46, justifyContent: 'center', alignItems: 'flex-start' }}
      >
        <MiLineIcon name="chevron-left" size={24} />
      </Pressable>
    </View>
  );
}

/** Dividers `245:1040` / `245:1056` / `245:1067`: 1 tall (not a hairline), border/subtle. */
function Divider() {
  return <View style={{ height: 1, backgroundColor: mitowColors.borderSubtle }} />;
}

/**
 * The Transaction ID row's trailing icon/color/copy at 24 (a swap of the Summary Row's chevron
 * slot). Copies the value; no feedback is drawn, so only a light haptic and, once the copy has
 * landed, a screen-reader announcement follow; a failed copy is ignored and announces nothing.
 * Drawn but inert while the ID is unknown.
 */
function CopyButton({ value }: { value: string | null }) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  if (!value) return <MiColorIcon name="copy" size={24} />;

  return (
    <Pressable
      onPress={() => {
        copyText(value)
          .then(() => AccessibilityInfo.announceForAccessibility('Transaction ID copied'))
          .catch(() => {});
      }}
      pressScale={theme.motion.pressScale.chip}
      haptic="light"
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Copy transaction ID"
    >
      <MiColorIcon name="copy" size={24} />
    </Pressable>
  );
}
