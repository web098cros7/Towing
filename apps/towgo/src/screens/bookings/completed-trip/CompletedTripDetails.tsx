import React, { useCallback } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiButton,
  MiCard,
  MiColorIcon,
  MiHelpChip,
  MiLineIcon,
  MiMenuCard,
  MiMenuRow,
  MiScreen,
  MiServiceRow,
  MiText,
  mitowColors,
  mitowLayout,
} from '@/design';
import { DriverInfoCard } from '@/features/booking/components/DriverInfoCard';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import type { BookingDetail } from '@/features/bookings/types';
import { openDriverChat } from '@/features/chat/openDriverChat';
import { useInvoiceLink } from '@/features/payments/api/payments.queries';
import { trackingDataSource } from '@/features/tracking/api/trackingDataSource';
import type { RootStackParamList } from '@/navigation/types';
import {
  displayDriver,
  ratingLabel,
  vehicleModelLabel,
  type BookingTrackingDisplay,
} from '@/screens/booking/tracking/trackingDisplay';
import { serviceTitle } from '@/features/services/data/serviceTitles';
import { formatPaise } from '@/utils/format';
import { paidAtLabel } from '@/screens/payment/paymentDisplay';
import { bookingMethod, methodIconName, paidAtFor, paidViaLabel } from './completedTripDisplay';
import { RouteMap } from './RouteMap';
import { TripRouteCard } from './TripRouteCard';
import { openTripInMaps } from './tripMapLink';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Content `245:882`: padding 0 / 21 / 24 (bottom), gap 16. */
const CONTENT_BOTTOM = 24;
/** Bottom bar `245:999`: 1 border/subtle top stroke, padding 12 / 21 / 34. */
const BAR_PAD_TOP = 12;
const BAR_PAD_BOTTOM = 34;
const BAR_BORDER = 1;
/** "Book Again" `245:1000`: Secondary Button Tone=Strong at the drawn 132, not flexed. */
const BOOK_AGAIN_WIDTH = 132;
/** Service row `245:955`: the subtitle box of "Tata 407 (Flatbed)". */
const VEHICLE_SLOT_WIDTH = 119;
/** Service card `245:954`: padding 12 vertical, 14 horizontal, with the 1.2 stroke inside. */
const SERVICE_PAD = 12;
const SERVICE_SIDE = 14;
const SERVICE_BORDER = 1.2;
/** 245:982 Payment `245:981`: padding 5 vertical, 1.2 stroke inside. */
const PAYMENT_PAD = 5;
/** Figma text box width of the payment row's amount, for its placeholder bar. The title and
 * subtitle are `w-full` in the master, so those slots fill the column instead. */
const AMOUNT_SLOT = 40;

const noop = () => {};

/**
 * Figma 35 · Completed Trip Details (`243:929`), rendered by the `BookingDetails` route for every
 * finished trip (see `BookingDetailsScreen`, which routes on the status).
 *
 * A pushed root route with no tab bar, drawn at its full scroll length (393 × 1042): everything
 * scrolls except the bottom bar `245:999`, which is pinned. Content column 21 / 21 / 24, gap 16:
 * the top bar (bare Back chevron + Help chip), the title, the route map, the trip route card, and
 * the three titled sections — Service Details, Driver Details, Payment Details.
 *
 * WHY EVERY FINISHED TRIP: 35 shows every finished trip. For a `paid` one it draws "Paid via UPI"
 * and a receipt, and its Payment row opens the invoice. For an unpaid `completed` one the Payment
 * row holds its placeholder bars (no method, no paid time) and opens 27 · Payment — the customer's
 * way to pay later — while "Download Receipt" explains the receipt comes once the trip is paid.
 * Both 30's "View Booking Details" and the Tracking screen's finished hand-off land on this route
 * and therefore here.
 *
 * DATA: everything comes from the booking detail and the tracking payload, both of which 20
 * already reads for this route, so nothing extra is fetched. Where the two contracts have no
 * field for a value the design draws, the slot keeps its drawn size with a placeholder bar; the
 * two such fields are `paymentMethod` and the paid instant (see `completedTripDisplay`).
 */
export function CompletedTripDetails({
  booking,
  tracking,
  onBack,
  onHelp,
}: {
  booking: BookingDetail;
  tracking: BookingTrackingDisplay | undefined;
  onBack: () => void;
  onHelp: () => void;
}) {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const setServiceSlug = useBookingStore((s) => s.setServiceSlug);
  const invoice = useInvoiceLink();

  const driver = displayDriver(tracking);
  /** Finished but not paid yet: nothing was paid, so no method, no paid time and no receipt exist. */
  const unpaid = booking.status === 'completed';
  const method = unpaid ? null : bookingMethod(booking);
  const paidAtIso = paidAtFor(booking.id);
  const paidAt = !unpaid && paidAtIso ? paidAtLabel(paidAtIso) : null;

  /** Call: the driver's number handed to the phone's dialer, exactly as 20 and 18 do. */
  const onCall = useCallback(async () => {
    try {
      const contact = await trackingDataSource.contact(booking.id);
      if (!contact.dialNumber) return;
      await Linking.openURL(`tel:${contact.dialNumber}`);
    } catch {
      // Nothing drawn for a failure; the button stays available to try again.
    }
  }, [booking.id]);

  /** Message: 22 Chat with Driver through the one shared action, as 20 does. */
  const onMessage = useCallback(
    () => void openDriverChat(navigation, booking.id),
    [booking.id, navigation],
  );

  /** "View on Map" `245:902`: the phone's maps app, pickup to drop. */
  const onOpenMap = useCallback(() => openTripInMaps(booking), [booking]);

  /**
   * "Book Again" `245:1000`: the same reset 30's "Book Another Tow" does, so Back on 10 goes
   * Home. ⚠ The pickup and drop are NOT pre-filled: the design draws no such behaviour and the
   * booking store holds no address fields, so this starts a fresh booking at Enter Location.
   * Reported.
   */
  const bookAgain = useCallback(() => {
    setServiceSlug(booking.serviceSlug || 'car_tow');
    navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'BookLocation' }] });
  }, [booking.serviceSlug, navigation, setServiceSlug]);

  /** Unpaid trip: 27 · Payment is the customer's way to pay later. */
  const openPayment = useCallback(
    () => navigation.navigate('Payment', { bookingId: booking.id }),
    [booking.id, navigation],
  );

  /**
   * "Download Receipt" `245:1005`: mint §9.1.10's signed URL and open it. On failure, the same
   * Alert pattern 20 uses for its own failed actions. An unpaid trip has no receipt yet, so it
   * explains that instead of calling the invoice.
   */
  const downloadReceipt = useCallback(() => {
    if (unpaid) {
      Alert.alert('Receipt not ready yet', 'Your receipt is available once this trip is paid.');
      return;
    }
    invoice.mutate(booking.id, {
      onSuccess: (link) => {
        Linking.openURL(link.url).catch(() => {
          Alert.alert('Could not open the receipt', 'Please try again in a moment.');
        });
      },
      onError: () => {
        Alert.alert('Could not get your receipt', 'Please try again in a moment.');
      },
    });
  }, [booking.id, invoice, unpaid]);

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
            paddingTop: BAR_PAD_TOP - BAR_BORDER,
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(insets.bottom, BAR_PAD_BOTTOM),
            borderTopWidth: BAR_BORDER,
            borderTopColor: mitowColors.borderSubtle,
            backgroundColor: mitowColors.surfacePage,
          }}
        >
          <MiButton
            tone="secondaryStrong"
            label="Book Again"
            onPress={bookAgain}
            style={{ width: BOOK_AGAIN_WIDTH }}
          />
          <MiButton
            tone="dark"
            label="Download Receipt"
            onPress={downloadReceipt}
            loading={invoice.isPending}
            style={{ flex: 1 }}
            accessibilityLabel="Download Receipt"
            // The leading colour icon at 22 is part of the label's row, so it goes through
            // MiButton's own leading slot rather than a bespoke wrapper.
            leadingSlot={<MiColorIcon name="download" size={22} />}
          />
        </View>
      }
    >
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          paddingBottom: CONTENT_BOTTOM,
          gap: mitowLayout.blockGap,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Header onBack={onBack} onHelp={onHelp} />

        <RouteMap booking={booking} onOpenMap={onOpenMap} />

        <TripRouteCard booking={booking} tracking={tracking} />

        {/* Service Details `245:952`: heading over a one-row card, gap 12. */}
        <Section title="Service Details">
          <MiCard
            radius={16}
            paddingVertical={SERVICE_PAD - SERVICE_BORDER}
            paddingHorizontal={SERVICE_SIDE - SERVICE_BORDER}
          >
            <MiServiceRow
              title={serviceTitle(booking.serviceSlug)}
              subtitle={vehicleModelLabel(driver)}
              subtitleSlotWidth={VEHICLE_SLOT_WIDTH}
              price={formatPaise(booking.farePaise)}
            />
          </MiCard>
        </Section>

        {/* Driver Details `245:961`: heading over Driver Row, gap 12. */}
        <Section title="Driver Details">
          <DriverInfoCard
            driver={driver ? { name: driver.name, photoUrl: driver.photoUrl } : null}
            ratingText={driver ? ratingLabel(driver.rating, driver.totalTrips) : null}
            onCall={driver ? () => void onCall() : noop}
            onMessage={driver ? onMessage : noop}
          />
        </Section>

        {/* Payment Details `245:979`: heading over a one-row Menu Card, gap 12. */}
        <Section title="Payment Details">
          <MiMenuCard
            radius={16}
            paddingVertical={PAYMENT_PAD}
            borderInLayout={false}
            dividers={false}
          >
            <MiMenuRow
              icon={method ? { color: methodIconName(method) } : null}
              title={paidViaLabel(method)}
              titleSlotWidth="fill"
              subtitle={paidAt}
              subtitleSlotWidth="fill"
              value={formatPaise(booking.farePaise)}
              valueSlotWidth={AMOUNT_SLOT}
              showChevron
              // DECISION: paid → the row opens the same receipt as "Download Receipt" — one
              // destination for the trip's paperwork, reached from either control. Unpaid →
              // 27 · Payment, the customer's way to pay later (35 draws no unpaid state;
              // reported).
              onPress={unpaid ? openPayment : downloadReceipt}
              accessibilityLabel={
                unpaid ? 'Payment details. Pay for this trip' : 'Payment details. Open receipt'
              }
            />
          </MiMenuCard>
        </Section>
      </ScrollView>
    </MiScreen>
  );
}

/**
 * Header `245:883`: the top bar (351 × 46, space-between, items centred), a 12 gap, then the
 * title block (gap 4) — "Trip Completed" in Display 27 over the Body M 15 subtitle.
 *
 * Back `245:885` is a bare 46 × 46 frame (no fill, border, shadow or circle) with
 * icon/chevron-left 24 on the 21 margin; the whole box is the hit area, exactly as 20's header
 * builds it.
 */
function Header({ onBack, onHelp }: { onBack: () => void; onHelp: () => void }) {
  const Pressable = usePressablePrimitive();

  return (
    <View style={{ gap: mitowLayout.headingGap }}>
      <View
        style={{
          height: 46,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
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
        <MiHelpChip onPress={onHelp} />
      </View>
      <View style={{ gap: 4 }}>
        <MiText variant="display27" numberOfLines={1} accessibilityRole="header">
          Trip Completed
        </MiText>
        <MiText variant="bodyM15" color="secondary">
          Your vehicle has been towed successfully
        </MiText>
      </View>
    </View>
  );
}

/** A titled section: its heading (`heading18`) then its content, gap 12. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: mitowLayout.headingGap }}>
      <MiText variant="heading18" accessibilityRole="header">
        {title}
      </MiText>
      {children}
    </View>
  );
}
