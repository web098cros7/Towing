import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { JobStatus } from '@towing/api-contracts';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiButton,
  MiCard,
  MiHelpChip,
  MiLineIcon,
  MiScreen,
  MiSpinner,
  MiSummaryRow,
  MiText,
  MiTimelineRow,
  mitowColors,
  mitowLayout,
} from '@/design';
import { DriverInfoCard } from '@/features/booking/components/DriverInfoCard';
import { useBooking, useCancelBooking, CancellationFeeNotPaidError } from '@/features/bookings/api/bookings.queries';
import { callDriver } from '@/features/calling/callDriver';
import { openDriverChat } from '@/features/chat/openDriverChat';
import { useShareTrip } from '@/features/tracking/api/tracking.queries';
import { CancelTripSheet } from '@/features/tracking/components/CancelTripSheet';
import { track } from '@/lib/analytics/analytics';
import type { RootStackParamList } from '@/navigation/types';
import { VehicleCard } from '@/screens/booking/tracking/VehicleCard';
import {
  displayDriver,
  ratingLabel,
  vehicleModelLabel,
  vehiclePlateLabel,
} from '@/screens/booking/tracking/trackingDisplay';
import { StatusCard } from './booking-details/StatusCard';
import { isLiveStatus, statusCardCopy, timelineRows } from './booking-details/bookingProgress';
import { useBookingTracking, useEtaMinutes } from './booking-details/useBookingLive';
import { CompletedTripDetails } from './completed-trip/CompletedTripDetails';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Bottom bar `239:689`: padding 12 top (from the outer edge), 34 bottom (the home-indicator zone). */
const BAR_PAD_TOP = 12;
const BAR_PAD_BOTTOM = 34;
/** Top border 1 border/subtle, inside and not in layout: RN's border takes layout space, so 12 − 1. */
const BAR_BORDER = 1;
/**
 * "Share Live Location" side padding. The label is 146 wide at Strong 16 and the
 * drawn inner width is only 137.5 at the master's padding 16; Figma lets the
 * centred label run into the padding (11.75 either side at 393). The label is
 * centred, so a smaller padding renders identically wherever it fits and only
 * stops the single-line label from ellipsising. 8 is not enough on a 360-wide
 * Android phone (Inter SemiBold measures 136.8 at the 15 pt it scales to, against
 * 137 inside a 153 button), so 4 leaves room without changing the drawn look.
 */
const SHARE_PAD = 4;
/** Timeline Row time box width for "10:05 AM" (61), used while a reached step's instant is unknown. */
const TIME_SLOT_WIDTH = 61;
/** Locations card `239:670`: padding 14 from the outer edge, the 1.2 stroke not in layout. */
const LOCATIONS_BORDER = 1.2;

const noop = () => {};

/**
 * Figma 20 · Booking Details (`238:554`), with 21 · Cancel Trip (`291:2309`) as a
 * sheet over it. A pushed root route with no tab bar.
 *
 * Drawn at its full scroll length (393 × 1024). Everything scrolls, the header
 * included; only the bottom bar is pinned. Content column: padding 0 / 21 / 24,
 * gap 16. Top to bottom: the top bar (bare Back chevron + Help chip), the title,
 * the status card, the six-row booking timeline, a divider, Driver Details, a
 * divider, Tow Truck Details (vehicle card + locations card). Pinned: "Cancel
 * Booking" + "Share Live Location".
 *
 * Only the `en_route` state is drawn. The status card and timeline follow the
 * booking status (`booking-details/bookingProgress.ts`); the bottom bar shows
 * while the booking is live, which is every status the API lets a customer
 * cancel from (searching, assigned, en route, arrived, in progress), and is hidden
 * once it is finished (completed, paid, cancelled, no drivers found, disputed).
 *
 * DATA: the booking detail gives the status, the confirm time and the two
 * addresses; the tracking payload gives the driver, vehicle, ETA and the other
 * timeline instants (`GET /bookings/:id` carries no driver at all). Slots whose
 * value is not known keep their drawn size with a placeholder bar (18's rule),
 * including the Driver and Tow Truck sections before a driver is assigned.
 */
export function BookingDetailsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'BookingDetails'>>().params;

  const { data: booking, isPending, isError, refetch } = useBooking(bookingId, { poll: true });

  // The booking of record's status: polled every 10 s while live, and the one the
  // My Bookings active-trip card reads (in test mode the shared mock trip clock
  // drives it, so it agrees with the Tracking screen).
  const status: JobStatus | undefined = booking?.status;
  const live = isLiveStatus(status);
  // Nothing to read while searching: no driver, vehicle or ETA exists before
  // assignment (the server sends `driver: null`). Read from assignment on.
  const searching = status === 'searching';
  const { data: tracking } = useBookingTracking(bookingId, booking != null && !searching, live);

  const etaMinutes = useEtaMinutes(searching ? undefined : tracking);
  const driver = searching ? null : displayDriver(tracking);

  const shareTrip = useShareTrip(bookingId);
  const cancelBooking = useCancelBooking();
  const [cancelOpen, setCancelOpen] = useState(false);
  // A booking that stops being live (the driver started the tow, or it was
  // cancelled elsewhere) can no longer be cancelled here: close 21 over it.
  useEffect(() => {
    if (!live) setCancelOpen(false);
  }, [live]);

  // --- Actions -------------------------------------------------------------

  /** Back `239:555`: to whatever pushed this screen (18's vehicle card, or a My Bookings row). */
  const goBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Tabs', { screen: 'Home' });
  }, [navigation]);

  /** Help `239:558`: 58 Support, as every Help chip does. */
  const openSupport = useCallback(() => navigation.navigate('Support'), [navigation]);

  /**
   * Status card `239:567` (chevron): the live view of this trip. 20 is usually
   * pushed FROM 18, so `pop: true` returns to that screen instead of stacking a
   * second copy; with none underneath (opened from My Bookings) it pushes one.
   * A booking still searching has no driver to track: its live view is 16
   * Searching, which hands off to 18 by itself once a driver accepts.
   */
  const openLiveView = useCallback(() => {
    if (status === 'searching') navigation.navigate('Searching', { bookingId }, { pop: true });
    else navigation.navigate('Tracking', { bookingId }, { pop: true });
  }, [bookingId, navigation, status]);

  /**
   * Status card of a finished but unpaid trip (`completed`): 27 Payment, the customer's way
   * back to pay later (27-28 Data gap 12). A paid trip's card stays inert.
   */
  const openPayment = useCallback(
    () => navigation.navigate('Payment', { bookingId }),
    [bookingId, navigation],
  );

  /** Call: the same as 18, through the shared `callDriver` helper (which warns on an unmasked number). */
  const onCall = useCallback(() => void callDriver(bookingId), [bookingId]);

  /** Message: 22 Chat with Driver through the one shared action. */
  const onMessage = useCallback(
    () => void openDriverChat(navigation, bookingId),
    [bookingId, navigation],
  );

  /**
   * Share Live Location `239:695`: mint (or reuse) the §11.7 link and hand it to
   * the phone's share sheet, as the tracking screen does. The share message is
   * the app's existing copy; Figma draws none (DATA-GAPS-20-21.md).
   * `trip_shared` is tracked only for a completed share, as on 18 and 26.
   */
  const onShare = useCallback(async () => {
    try {
      const link = await shareTrip.mutateAsync();
      const result = await Share.share({
        message: `Follow my tow live: ${link.url}`,
        url: link.url,
      });
      // Counted only when the sheet reports a share: iOS resolves `dismissedAction` for a
      // closed sheet (Android always reports `sharedAction`, as it cannot tell).
      if (result.action === Share.sharedAction) track('trip_shared');
    } catch {
      // A failed mint or a share sheet that fails to open. Figma draws no failed
      // state, so it is the system alert (a silent tap reads as "shared").
      Alert.alert("Couldn't share your live location", 'Check your connection and try again.');
    }
  }, [shareTrip]);

  /** After a successful cancel: Home, as the tracking screen does after its cancel. */
  const goHome = useCallback(() => {
    navigation.popToTop();
    navigation.navigate('Tabs', { screen: 'Home' });
  }, [navigation]);

  /** 21's "Yes, Cancel Trip": cancels with the chosen chip's label as the reason. */
  const onCancelConfirm = useCallback(
    (reason?: string) => {
      cancelBooking.mutate(
        { bookingId, reason },
        {
          onSuccess: () => {
            setCancelOpen(false);
            goHome();
          },
          onError: (error) => {
            // Closing the fee's payment sheet is a choice, not a failure.
            if (error instanceof CancellationFeeNotPaidError) return;
            setCancelOpen(false);
            // The tracking screen's existing failure copy. 21 draws no failure
            // state; a chargeable tier now pays its fee first (useCancelBooking).
            Alert.alert(
              'Could not cancel',
              'This trip cannot be cancelled here. Please call your driver or contact support.',
            );
          },
        },
      );
    },
    [bookingId, cancelBooking, goHome],
  );

  // --- Content -------------------------------------------------------------

  let content: React.ReactNode;
  if (isPending) {
    // Not drawn: the loader until the booking arrives.
    content = (
      <View style={{ alignItems: 'center', paddingTop: 24 }}>
        <MiSpinner />
      </View>
    );
  } else if (isError && !booking) {
    // Only when there is nothing to show: a failed background poll keeps the
    // loaded booking on screen, and the next poll tries again.
    content = (
      <LoadProblem
        title="Couldn't load this booking"
        body="Check your connection and try again."
        onRetry={() => void refetch()}
      />
    );
  } else if (!booking || !status) {
    content = <LoadProblem title="Booking not found" body="This booking may have been removed." />;
  } else {
    const card = statusCardCopy(status, etaMinutes);
    const rows = timelineRows(status, booking.createdAt, tracking);

    content = (
      <>
        {/* Status `239:567`: opens the live view while the trip is live, 27 Payment once it is
            completed and unpaid (and then says "Pay for this trip" to screen readers). */}
        <StatusCard
          title={card.title}
          subtitle={card.subtitle}
          onPress={live ? openLiveView : status === 'completed' ? openPayment : undefined}
          actionLabel={!live && status === 'completed' ? 'Pay for this trip' : undefined}
        />

        {/* Booking timeline `239:576`: six Timeline Rows, 40 tall, the last 28 with no connector. */}
        <View style={{ overflow: 'hidden' }}>
          {rows.map((row, index) => {
            const last = index === rows.length - 1;
            return (
              <MiTimelineRow
                key={row.title}
                state={row.state}
                title={row.title}
                time={row.time}
                timeSlotWidth={TIME_SLOT_WIDTH}
                last={last}
                height={last ? 28 : 40}
              />
            );
          })}
        </View>

        <Divider />

        {/*
          Driver details `239:642`: gap 12. Before a driver exists (searching) the
          row keeps its drawn slots with placeholders, and Call / Message do
          nothing: there is nobody to call or write to yet.
        */}
        <View style={{ gap: mitowLayout.headingGap }}>
          <MiText variant="heading18" accessibilityRole="header">
            Driver Details
          </MiText>
          <DriverInfoCard
            driver={driver ? { name: driver.name, photoUrl: driver.photoUrl } : null}
            ratingText={driver ? ratingLabel(driver.rating, driver.totalTrips) : null}
            onCall={driver ? () => void onCall() : noop}
            onMessage={driver ? onMessage : noop}
          />
        </View>

        <Divider />

        {/* Tow truck details `239:661`: gap 12. */}
        <View style={{ gap: mitowLayout.headingGap }}>
          <MiText variant="heading18" accessibilityRole="header">
            Tow Truck Details
          </MiText>
          {/* Vehicle `239:663`: the chevron is hidden on this instance and the card is not tappable. */}
          <VehicleCard
            plate={vehiclePlateLabel(driver)}
            model={vehicleModelLabel(driver)}
            showChevron={false}
          />
          {/* Locations `239:670`: no divider between the rows, no chevrons. */}
          <MiCard
            radius={16}
            borderWidth={LOCATIONS_BORDER}
            elevation="card"
            padding={14 - LOCATIONS_BORDER}
            gap={15}
          >
            <MiSummaryRow label="Pickup Location" value={booking.originLabel} icon="map-pin" />
            <MiSummaryRow label="Drop Location" value={booking.destinationLabel} icon="map-pin" />
          </MiCard>
        </View>
      </>
    );
  }

  const showBar = booking != null && live;

  /*
   * A FINISHED booking is 35 · Completed Trip Details, not 20. "Finished" is the three statuses
   * My Bookings badges "Completed": `completed`, `paid` and `disputed`. The route is decided by
   * the STATUS rather than by a second screen, because every caller that lands here (30's "View
   * Booking Details", the Tracking screen's paid hand-off, a My Bookings row) already knows only
   * a `bookingId` — routing on the status is what makes them all arrive at the right screen with
   * no changes.
   *
   * A `completed` trip that is not paid yet also gets 35 (owner decision, 22 Sep): 35's Payment
   * Details row then leads to 27 · Payment, the customer's way to pay later (see
   * `CompletedTripDetails`).
   */
  if (booking && (status === 'completed' || status === 'paid' || status === 'disputed')) {
    return (
      <CompletedTripDetails
        booking={booking}
        tracking={tracking}
        onBack={goBack}
        onHelp={openSupport}
      />
    );
  }

  return (
    <MiScreen
      edges={['top']}
      footer={
        showBar ? (
          <BottomBar
            bottomPadding={Math.max(insets.bottom, BAR_PAD_BOTTOM)}
            // The server refuses a share until a driver is assigned (409 while searching).
            shareDisabled={status === 'searching'}
            sharing={shareTrip.isPending}
            onCancel={() => setCancelOpen(true)}
            onShare={() => void onShare()}
          />
        ) : null
      }
    >
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        // Content `239:552`: padding 0 / 21 / 24, gap 16. With no pinned bar the
        // column also clears the home indicator.
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          paddingBottom: 24 + (showBar ? 0 : insets.bottom),
          gap: mitowLayout.blockGap,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Header onBack={goBack} onHelp={openSupport} />
        {content}
      </ScrollView>

      {booking && status ? (
        <CancelTripSheet
          bookingId={bookingId}
          visible={cancelOpen}
          onDismiss={() => setCancelOpen(false)}
          onConfirm={onCancelConfirm}
          isCancelling={cancelBooking.isPending}
          driverName={driver?.name ?? null}
          etaMinutes={etaMinutes}
          status={status}
        />
      ) : null}
    </MiScreen>
  );
}

/**
 * Header `239:553`: the top bar (351 × 46, space-between, items centred), a 12
 * gap, then "Booking Details" in Display 27.
 *
 * Back `239:555` is a bare 46 × 46 frame (no fill, border, shadow or circle) with
 * icon/chevron-left 24 on the 21 margin; the whole box is the hit area. Help
 * `239:558` is the full Help Button (padding 16, 95 wide), 21 from the right edge.
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
      <MiText variant="display27" numberOfLines={1} accessibilityRole="header">
        Booking Details
      </MiText>
    </View>
  );
}

/** Divider `239:641` / `239:660`: 1 tall (not a hairline), border/subtle, full content width. */
function Divider() {
  return <View style={{ height: 1, backgroundColor: mitowColors.borderSubtle }} />;
}

/**
 * Bottom bar (pinned) `239:689`: white, a 1 border/subtle top border, padding
 * 12 / 21 / 34, gap 12, items top-aligned. "Cancel Booking" is Secondary Button
 * Tone=Strong, "Share Live Location" is Primary Button; both flex 1 × 54 with no icons.
 */
function BottomBar({
  bottomPadding,
  shareDisabled,
  sharing,
  onCancel,
  onShare,
}: {
  bottomPadding: number;
  shareDisabled: boolean;
  sharing: boolean;
  onCancel: () => void;
  onShare: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingTop: BAR_PAD_TOP - BAR_BORDER,
        paddingHorizontal: mitowLayout.sideMargin,
        paddingBottom: bottomPadding,
        borderTopWidth: BAR_BORDER,
        borderTopColor: mitowColors.borderSubtle,
        backgroundColor: mitowColors.surfacePage,
      }}
    >
      <MiButton
        tone="secondaryStrong"
        label="Cancel Booking"
        onPress={onCancel}
        style={{ flex: 1 }}
      />
      <MiButton
        tone="dark"
        label="Share Live Location"
        onPress={onShare}
        loading={sharing}
        disabled={shareDisabled}
        paddingLeft={SHARE_PAD}
        paddingRight={SHARE_PAD}
        style={{ flex: 1 }}
      />
    </View>
  );
}

/**
 * Not drawn: the booking could not be loaded, or does not exist. The screen's
 * header stays (so Back and Help still work) with a short message under it,
 * using the app's existing copy.
 */
function LoadProblem({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <View style={{ gap: mitowLayout.headingGap, paddingTop: 8 }}>
      <View style={{ gap: 4 }}>
        <MiText variant="heading18">{title}</MiText>
        <MiText variant="bodyM15" color="secondary">
          {body}
        </MiText>
      </View>
      {onRetry ? <MiButton tone="secondarySubtle" label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}
