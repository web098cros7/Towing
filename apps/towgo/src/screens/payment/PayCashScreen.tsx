import React, { useCallback, useEffect, useRef } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CommonActions,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiButton,
  MiCard,
  MiColorIcon,
  MiInfoBanner,
  MiLineIcon,
  MiScreen,
  MiServiceRow,
  MiSummaryRow,
  MiText,
  mitowColors,
  mitowLayout,
} from '@/design';
import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import { bookingsDataSource } from '@/features/bookings/api/bookingsDataSource';
import { serviceTitle } from '@/features/services/data/serviceTitles';
import type { RootStackParamList } from '@/navigation/types';
import { displayDriver, vehicleModelLabel } from '@/screens/booking/tracking/trackingDisplay';
import { useBookingTracking } from '@/screens/bookings/booking-details/useBookingLive';
import { trackingDataSource } from '@/features/tracking/api/trackingDataSource';
import { formatPaise } from '@/utils/format';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Actions `245:1087`: the lower button's bottom edge sits 34 above the 852 frame. */
const FOOTER_BOTTOM_GAP = 34;
/** Secure payment `245:1078`: the Info Banner instance's fixed height (the master is 67). */
const BANNER_HEIGHT = 71;
/** Service `245:1034`: the subtitle box of "Tata 407 (Flatbed)", for its placeholder bar. */
const VEHICLE_SLOT_WIDTH = 119;
/** How often the booking is read while the driver is confirming the cash. */
const POLL_INTERVAL_MS = 3_000;

/**
 * Figma 31b · Pay Cash to Driver (`502:18290`), root route `PayCash { bookingId, amountPaise }`.
 * Shown after the customer chooses Cash on 27 and taps Pay, until the DRIVER confirms the cash
 * in the driver app. A copy of 31 · Payment Successful with the Success Mark swapped for a
 * yellow cash illustration, the copy changed, and the footer's two buttons swapped for "Call
 * Driver" and "Pay Online Instead".
 *
 * The booking is polled every 3 s: when it turns `paid` (the driver confirmed), the screen
 * resets to `[Tabs, PaymentSuccess]` exactly as 27 does after a capture, so 31 shows the
 * receipt. The reset is guarded so it fires once.
 *
 * Back (the chevron) returns to 27 Payment, where Cash is still selected; "Pay Online Instead"
 * does the same, and the server closes the cash request automatically when an online intent
 * opens.
 */
export function PayCashScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { bookingId, amountPaise } = useRoute<RouteProp<RootStackParamList, 'PayCash'>>().params;

  // Poll the booking until the driver confirms the cash. `useBooking`'s poll option is
  // terminal-aware (it stops on a non-active status), so a direct `useQuery` with a fixed
  // interval is used here instead.
  const { data: booking } = useQuery({
    queryKey: bookingsKeys.detail(bookingId),
    queryFn: () => bookingsDataSource.getBooking(bookingId),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const { data: tracking } = useBookingTracking(bookingId, true, false);

  const price = formatPaise(amountPaise);
  const title = serviceTitle(booking?.serviceSlug);
  const vehicleModel = vehicleModelLabel(displayDriver(tracking));
  const driverName = booking?.driverName ?? 'your driver';
  const plate = booking?.vehiclePlate ?? null;
  const driverValue = plate ? `${driverName} · ${plate}` : driverName;

  // Reset to 31 once the driver confirms. Guarded so the reset fires once even if the poll
  // returns `paid` again before the navigation lands.
  const resetRef = useRef(false);
  useEffect(() => {
    if (resetRef.current) return;
    if (booking?.status !== 'paid') return;
    resetRef.current = true;
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'Tabs' },
          {
            name: 'PaymentSuccess',
            params: {
              bookingId,
              payment: {
                method: 'cash',
                transactionId: null,
                paidAt: booking.paidAt ?? new Date().toISOString(),
                amountPaise,
              },
            },
          },
        ],
      }),
    );
  }, [amountPaise, booking, bookingId, navigation]);

  /** Back `245:1014`: 27 Payment, where Cash is still selected. */
  const goBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  /**
   * "Call Driver": the same call BookingDetailsScreen makes — read the contact from the
   * tracking payload, then open the dialer. A missing number or a failed open alerts.
   */
  const callDriver = useCallback(async () => {
    try {
      const contact = await trackingDataSource.contact(bookingId);
      if (!contact?.dialNumber) {
        Alert.alert('Could not call the driver', 'No phone number is available yet.');
        return;
      }
      await Linking.openURL(`tel:${contact.dialNumber}`);
    } catch {
      Alert.alert('Could not call the driver', 'Please try again.');
    }
  }, [bookingId]);

  /** "Pay Online Instead": back to 27, where the customer picks another method. */
  const payOnline = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            gap: 12,
            paddingBottom: Math.max(insets.bottom, FOOTER_BOTTOM_GAP),
          }}
        >
          <MiButton tone="dark" label="Call Driver" onPress={() => void callDriver()} />
          <MiButton tone="outline" label="Pay Online Instead" onPress={payOnline} />
        </View>
      }
    >
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: mitowLayout.blockGap,
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar onBack={goBack} />

        {/* Illustration `502:18293`: a 112 × 112 brand-yellow-soft circle holding a 64 cash icon. */}
        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 112,
              height: 112,
              borderRadius: 56,
              backgroundColor: mitowColors.brandYellowSoft,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <MiColorIcon name="cash" size={64} />
          </View>
        </View>

        {/* Title `502:18296`: gap 6, centred; the title shrinks on one line, the subtitle wraps. */}
        <View style={{ gap: 6, alignItems: 'center' }}>
          <MiText
            variant="display27"
            align="center"
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            Pay cash to your driver
          </MiText>
          <MiText variant="bodyL155" color="secondary" align="center">
            {`Hand ${price} to ${driverName}. Your trip is marked paid once the driver confirms.`}
          </MiText>
        </View>

        {/* Payment details `502:18299`: same card as 31, with Driver / Payment Method / Status. */}
        <MiCard radius={16} padding={12.8} gap={10}>
          <MiServiceRow
            title={title}
            subtitle={vehicleModel}
            subtitleSlotWidth={VEHICLE_SLOT_WIDTH}
            price={price}
          />
          <Divider />
          <MiSummaryRow icon={{ color: 'user' }} label="Driver" value={driverValue} />
          <Divider />
          <MiSummaryRow icon={{ color: 'cash' }} label="Payment Method" value="Cash" />
          <Divider />
          <MiSummaryRow
            icon={{ color: 'hourglass' }}
            label="Status"
            value="Waiting for the driver to confirm"
          />
        </MiCard>

        {/* Banner `502:18344`: the same success-soft Info Banner as 31, with cash copy. */}
        <MiInfoBanner
          tone="success"
          icon="info"
          height={BANNER_HEIGHT}
          title="Keep the exact amount ready"
          subtitle="Your receipt appears in the app once the driver confirms."
        />
      </ScrollView>
    </MiScreen>
  );
}

/**
 * Top bar `502:18291`: the same bare 46 × 46 Back frame as 31, chevron-left 24 on the 21 margin.
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

/** Dividers: 1 tall (not a hairline), border/subtle, as 31's. */
function Divider() {
  return <View style={{ height: 1, backgroundColor: mitowColors.borderSubtle }} />;
}
