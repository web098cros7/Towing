import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Share,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CommonActions,
  StackActions,
  useNavigation,
  usePreventRemove,
  useRoute,
  type NavigationAction,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BookingTracking } from '@towing/api-contracts';
import { usePressablePrimitive } from '@towing/ui';
import {
  mitowColors,
  mitowLayout,
  mitowRadii,
  mitowShadows,
  MiButton,
  MiCard,
  MiHelpChip,
  MiInfoBanner,
  MiMapButton,
  MiSheetPanel,
  MiText,
} from '@/design';
import { DriverInfoCard } from '@/features/booking/components/DriverInfoCard';
import { useBooking, useCancelBooking } from '@/features/bookings/api/bookings.queries';
import { openDriverChat } from '@/features/chat/openDriverChat';
import { recordMockCodeShown } from '@/features/tracking/api/mockTripClock';
import { trackingDataSource } from '@/features/tracking/api/trackingDataSource';
import { useRevokeShare, useShareTrip } from '@/features/tracking/api/tracking.queries';
import { BookingOtpCard } from '@/features/tracking/components/BookingOtpCard';
import { CancelTripSheet } from '@/features/tracking/components/CancelTripSheet';
import { ConnectionBanner } from '@/features/tracking/components/ConnectionBanner';
import { LiveEtaCard } from '@/features/tracking/components/LiveEtaCard';
import { StatusTimeline, hasTimelinePosition } from '@/features/tracking/components/StatusTimeline';
import {
  TrackingMap,
  type TrackingMapVariant,
} from '@/features/tracking/components/TrackingMap';
import { useCollectionCode } from '@/features/tracking/hooks/useCollectionCode';
import { useLiveTracking } from '@/features/tracking/hooks/useLiveTracking';
import { track } from '@/lib/analytics/analytics';
import { env } from '@/lib/env';
import { BottomSheet, haptics } from '@/motion';
import type { RootStackParamList } from '@/navigation/types';
import { ArrivalTimeline } from './tracking/ArrivalTimeline';
import { CollectionCodeCard } from './tracking/CollectionCodeCard';
import { EtaBanner } from './tracking/EtaBanner';
import { CodeHeading, StaticTripHeading } from './tracking/TripHeadings';
import { TripTimeline } from './tracking/TripTimeline';
import { VehicleCard } from './tracking/VehicleCard';
import {
  displayDriver,
  firstNameOf,
  ratingLabel,
  trackingDesignFor,
  vehicleModelLabel,
  vehiclePlateLabel,
  type TrackedDriverDisplay,
  type TrackingDesign,
} from './tracking/trackingDisplay';

/**
 * The live trip, one route (`Tracking`) drawing the rebuilt screen for each
 * status (`trackingDesignFor`):
 *
 * - Figma 18 · Driver En Route (`225:85`), `assigned` (and the first read): the
 *   ETA heading, the driver row, the vehicle card and "You're in safe hands".
 * - Figma 19 · Driver Arriving (`253:1228`), `en_route`: "Trip in Progress",
 *   the driver row, the vehicle card, the two-row arrival timeline and the same
 *   banner at 19's size.
 * - Figma 23 · Driver Arrived (`234:366`), `arrived`: "Driver has arrived", the
 *   driver row, the vehicle card, "Verified Driver & Vehicle" and Confirm Pickup.
 * - Figma 24 · Collection Code (`299:3840`), an in-screen step of `arrived`:
 *   Confirm Pickup opens it (no server call: there is no customer pickup
 *   action), and Back, the system back and Android's back button return to 23.
 * - Figma 25 · Trip in Progress (`234:382`), `in_progress`: "Trip in Progress",
 *   the three-row trip timeline and the ETA banner. Its Help chip opens 26
 *   Emergency (owner decision); every other Help chip opens 58 Support.
 *
 * The map stays mounted throughout. Each draws exactly what its frame draws over
 * a live map, with Back and Help over it; nothing else. The collection code,
 * sharing, the full timeline and cancel live on 20 Booking Details, one tap
 * away on the vehicle card (18, 19, 23).
 *
 * The trip then leaves this screen, once: `completed` REPLACES it with 27
 * Payment, `paid` with 20 Booking Details (or goes back to the 20 it was opened
 * from), and `cancelled` goes Home (under another screen, such as 26, it only
 * leaves the stack).
 *
 * The statuses no rebuilt screen draws (`searching` and `no_drivers_found`
 * after a driver drops out and the server re-dispatches, and `disputed`) keep
 * the previous draggable sheet and its content (collection code, share,
 * timeline, cancel).
 */

/** 18 / 19 Safe hands banner copy, verbatim (straight apostrophe U+0027). */
const SAFE_TITLE = "You're in safe hands";
const SAFE_SUBTITLE = 'All our drivers are verified and insured.';

/** 19 heading `254:1456`, verbatim; 25's `236:406` has the same title. */
const ARRIVING_TITLE = 'Trip in Progress';
const ARRIVING_SUBTITLE = 'Your tow truck is on the way to your location';

/** 25 heading subtitle `236:408`, verbatim (no full stop). */
const IN_TRANSIT_SUBTITLE = 'Your vehicle is being towed to the drop location';

/** 23 heading `236:334`, banner `236:360` and button `236:369`, verbatim (U+0026 ampersand). */
const ARRIVED_TITLE = 'Driver has arrived';
const ARRIVED_SUBTITLE = 'Your driver is at the pickup location';
const VERIFIED_TITLE = 'Verified Driver & Vehicle';
const VERIFIED_SUBTITLE = 'All our drivers are background verified.';
const CONFIRM_PICKUP = 'Confirm Pickup';

/** 18's sheet on the 852 frame: top 410.8, content to 360.3, then 80.9 to the bottom edge. */
const SHEET_CONTENT_HEIGHT = 360.3;
const EN_ROUTE_BOTTOM_SPACE = 80.9;
/** 19's sheet hugs its content (the banner ends at 440.1) over a 34 bottom padding (sheet 474.1, top 377.9). */
const ARRIVING_CONTENT_HEIGHT = 440.1;
const ARRIVING_BOTTOM_SPACE = 34;
/** 23's button ends at 435.8, 35.5 above the frame bottom (sheet 471.3, top 380.7). */
const ARRIVED_CONTENT_HEIGHT = 435.8;
const ARRIVED_BOTTOM_SPACE = 35.5;
/** 24's sheet hugs 362 of content over MiSheetPanel's 34 bottom padding (sheet 396, top 456). */
const CODE_CONTENT_HEIGHT = 362;
const CODE_BOTTOM_SPACE = 34;
/** 25's sheet is a fixed 463.6 (top 388.4): the banner ends at 395.2, then 68.4 of empty sheet. */
const IN_TRANSIT_CONTENT_HEIGHT = 395.2;
const IN_TRANSIT_BOTTOM_SPACE = 68.4;
/** Each bottom space includes the 34 home-indicator zone; taller system insets add to it. */
const DESIGN_BOTTOM_INSET = 34;

/** The rebuilt sheet on screen: 18, 19, 23, 24 (a step of 23 with its own, shorter sheet) or 25. */
type SheetDesign = 'enRoute18' | 'arriving19' | 'arrived23' | 'code24' | 'inTransit25';

const PEEK_RATIO = 0.28;
const DEFAULT_RATIO = 0.55;
const FULL_RATIO = 0.85;

/** Back-like actions that return 24 to 23 instead of leaving the screen. */
const BACK_ACTIONS: ReadonlySet<string> = new Set(['GO_BACK', 'POP']);

/**
 * Bookings whose arrival haptic has fired this session. Module-level rather than
 * per mount, so leaving Tracking and reopening it on the same arrived trip does
 * not buzz a second time.
 */
const arrivalBuzzedFor = new Set<string>();

export function TrackingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const route = useRoute<RouteProp<RootStackParamList, 'Tracking'>>();
  const { bookingId } = route.params;

  const { data: booking } = useBooking(bookingId, { poll: true });
  /** The poll stops on a terminal status so a finished trip does not keep polling. */
  const { tracking, presence } = useLiveTracking(bookingId, !isSettled(booking?.status));

  const shareTrip = useShareTrip(bookingId);
  const revokeShare = useRevokeShare(bookingId);
  const cancelBooking = useCancelBooking();
  const [cancelOpen, setCancelOpen] = useState(false);

  const goHome = useCallback(() => navigation.popToTop(), [navigation]);
  /**
   * Back `229:269`. The design draws no destination (spec Deviation 35, an open
   * product decision), so the chevron does what the system back gesture does on
   * this screen: return to whatever is underneath. From 16 Searching that is Home
   * (Searching resets the stack to Tabs → Tracking); from a push notification it
   * is the screen the customer was on. With nothing underneath it goes Home.
   */
  const goBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Tabs', { screen: 'Home' });
  }, [navigation]);
  const openSupport = useCallback(() => navigation.navigate('Support'), [navigation]);
  /**
   * 25's Help chip opens 26 Emergency for this trip. Figma draws no entry to 26;
   * screens are numbered in flow order, 26 follows 25, and Help is 25's only
   * control beyond Back and the map's (owner decision).
   */
  const openEmergency = useCallback(
    () => navigation.navigate('Emergency', { bookingId }),
    [bookingId, navigation],
  );
  const openBookingDetails = useCallback(
    () => navigation.navigate('BookingDetails', { bookingId }),
    [bookingId, navigation],
  );

  /**
   * The tracking payload is the fresher source (the socket patches it), but its
   * poll stops as soon as the BOOKING reads settled (above). So a settled booking
   * wins: a booking poll that saw `completed` before the tracking poll did would
   * otherwise leave 25 up for good, and the hand-off to 27 would never run.
   */
  const status = isSettled(booking?.status)
    ? booking?.status
    : (tracking?.status ?? booking?.status);

  /**
   * `cancelled` draws nothing of its own: the screen goes Home at once (below),
   * so it keeps the design that was up for that instant. `trackingDesignFor`
   * gives it `legacy`, which would flash the old sheet and swap the live map for
   * the legacy one (reloading it) just before Home. Before any status, 18.
   */
  const lastDesign = useRef<TrackingDesign>('enRoute18');
  const statusDesign = trackingDesignFor(status);
  if (status !== 'cancelled') lastDesign.current = statusDesign;
  const design = status === 'cancelled' ? lastDesign.current : statusDesign;

  /**
   * 25's payload for the instant before the hand-off. On `completed` and `paid`
   * (and a `cancelled` that lands on 25) 25 stays drawn while the next screen
   * slides in, but the live payload no longer describes the drop leg: the ETA
   * title and the "Est." time would turn into placeholder bars, and the map would
   * drop the route and zoom in on the drop. So 25 keeps drawing the last
   * `in_progress` payload.
   */
  const lastInProgress = useRef<BookingTracking | undefined>(undefined);
  if (tracking?.status === 'in_progress') lastInProgress.current = tracking;
  const tripTracking =
    design === 'inTransit25' && status !== 'in_progress'
      ? (lastInProgress.current ?? tracking)
      : tracking;

  // --- 23 → 24 ------------------------------------------------------------

  /**
   * 24 Collection Code is a step INSIDE the arrived status: "Confirm Pickup"
   * opens it and calls no API (the customer has no pickup action; the driver
   * starts the tow by entering this code). It only ever shows while `arrived`;
   * any other status closes it, so a later `arrived` opens on 23 again.
   */
  const [codeOpen, setCodeOpen] = useState(false);
  const showCode = design === 'arrived23' && codeOpen;
  useEffect(() => {
    if (design !== 'arrived23') setCodeOpen(false);
  }, [design]);
  const openCode = useCallback(() => setCodeOpen(true), []);
  const closeCode = useCallback(() => setCodeOpen(false), []);

  /**
   * Test mode only: the first time 24 is up, the mock driver "types the code"
   * and, a little later, the mock trip clock starts the tow (`in_progress`, 25).
   * With the live API the driver does that on their own phone.
   */
  useEffect(() => {
    if (showCode && env.useMocks) recordMockCodeShown(bookingId);
  }, [bookingId, showCode]);

  /**
   * Back on 24 returns to 23: the Back chevron (`closeCode`) directly, and
   * Android's back button and the iOS back swipe as a GO_BACK / POP caught here.
   * Anything else that would remove the screen (none today) closes 24 first and
   * then goes ahead.
   *
   * The route turns the iOS back swipe off (`gestureEnabled: false`), which
   * would stop the swipe before it ever reached this handler, so it is switched
   * on while 24 is up. With removal prevented, native-stack cancels the swipe
   * (`preventNativeDismiss`) and dispatches a POP, which lands here. 23 and
   * earlier keep it off.
   *
   * A cancelled trip is let straight through: 24 stays drawn for the instant
   * before Home, rather than closing to 23 on the way out.
   */
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: showCode });
  }, [navigation, showCode]);
  const pendingRemoval = useRef<NavigationAction | null>(null);
  usePreventRemove(showCode && status !== 'cancelled', ({ data }) => {
    if (!BACK_ACTIONS.has(data.action.type)) pendingRemoval.current = data.action;
    setCodeOpen(false);
  });
  useEffect(() => {
    if (showCode || !pendingRemoval.current) return;
    const action = pendingRemoval.current;
    pendingRemoval.current = null;
    navigation.dispatch(action);
  }, [navigation, showCode]);

  /**
   * §9.1.7's "arrived (OTP highlighted + haptic)": one success haptic on the
   * transition into 23, which the old collection-code card used to fire. Once
   * per booking, not on every poll that lands while arrived, and not again when
   * the screen is reopened on the same arrived trip (`arrivalBuzzedFor`).
   */
  useEffect(() => {
    if (design !== 'arrived23' || arrivalBuzzedFor.has(bookingId)) return;
    arrivalBuzzedFor.add(bookingId);
    haptics.success();
  }, [bookingId, design]);

  /**
   * 24's six digits. Read from 23 on, so they are there the moment Confirm
   * Pickup is tapped; gated on the server's own `otpAvailable`.
   */
  const collectionCode = useCollectionCode(
    bookingId,
    (booking?.otpAvailable ?? false) && design === 'arrived23',
  );

  /**
   * The end of the trip leaves this screen, once (a poll landing before the
   * screen has gone must not navigate a second time):
   * - `completed` → 27 Payment, REPLACING this screen, so Back on 27 never lands
   *   on a finished trip (no such state is drawn) (25 spec D5, owner decision);
   * - `paid` → 20 Booking Details, also replacing it: a trip paid for elsewhere
   *   has nothing left to track. When this trip's 20 is already right below
   *   (Tracking opened from it), this screen goes back to it instead, so the
   *   stack never holds two copies of 20;
   * - `cancelled` → Home.
   * 25 stays drawn for the instant before (`trackingDesignFor`), with the last
   * `in_progress` payload (`tripTracking`).
   *
   * 25's Help pushes 26 Emergency over this screen, and the polls keep running
   * under it. So each hand-off is aimed at THIS route and leaves 26 on top: a
   * screen's `replace` / `goBack` otherwise act on the FOCUSED route, because
   * the stack router reads the action's `source` only when its `target` names
   * the navigator (`atThisRoute`). A cancel removes only this route while
   * another screen is on top, so the customer is not pulled off it; on screen,
   * it goes Home.
   */
  const settledOnce = useRef(false);

  const atThisRoute = useCallback(
    (action: NavigationAction): NavigationAction => ({
      ...action,
      source: route.key,
      target: navigation.getState().key,
    }),
    [navigation, route.key],
  );

  useEffect(() => {
    if (!status || settledOnce.current) return;

    if (status === 'completed') {
      settledOnce.current = true;
      navigation.dispatch(atThisRoute(StackActions.replace('Payment', { bookingId })));
      return;
    }

    if (status === 'paid') {
      settledOnce.current = true;
      const { routes } = navigation.getState();
      const below = routes[routes.findIndex((r) => r.key === route.key) - 1];
      const detailsBelow =
        below?.name === 'BookingDetails' &&
        (below.params as RootStackParamList['BookingDetails'] | undefined)?.bookingId === bookingId;
      navigation.dispatch(
        atThisRoute(
          detailsBelow
            ? CommonActions.goBack()
            : StackActions.replace('BookingDetails', { bookingId }),
        ),
      );
      return;
    }

    if (status === 'cancelled') {
      settledOnce.current = true;
      if (navigation.isFocused()) {
        goHome();
        return;
      }
      navigation.dispatch((s) => {
        const routes = s.routes.filter((r) => r.key !== route.key);
        return CommonActions.reset({ ...s, routes, index: routes.length - 1 });
      });
    }
  }, [atThisRoute, bookingId, goHome, navigation, route.key, status]);

  const onShare = useCallback(async () => {
    try {
      const link = await shareTrip.mutateAsync();
      const result = await Share.share({
        message: `Follow my tow live: ${link.url}`,
        url: link.url,
      });
      // Counted only when the sheet reports a share: iOS resolves a dismissed sheet
      // with `dismissedAction` (Android always reports `sharedAction`).
      if (result.action === Share.sharedAction) track('trip_shared');
    } catch {
      // A failed mint lives on the mutation; a share sheet that fails to open draws nothing.
    }
  }, [shareTrip]);

  const onStopSharing = useCallback(() => revokeShare.mutate(), [revokeShare]);

  /**
   * Call (icon/phone) reaches the driver through `contact()` and hands the
   * number to the system dialer, which shows it before anything is dialled. The
   * design draws no dialog, warning or error, so none is added: a failed lookup
   * or a missing number leaves the screen as it is (data gap 9).
   *
   * Message (icon/message) opens 22 Chat with Driver on every screen here,
   * through `openDriverChat` — the in-app trip chat, live and in test mode.
   */
  const callDriver = useCallback(async () => {
    try {
      const contact = await trackingDataSource.contact(bookingId);
      if (!contact.dialNumber) return;
      await Linking.openURL(`tel:${contact.dialNumber}`);
    } catch {
      // Nothing drawn for a failure; the button stays available to try again.
    }
  }, [bookingId]);

  const onCall = useCallback(() => void callDriver(), [callDriver]);
  const onMessage = useCallback(
    () => void openDriverChat(navigation, bookingId),
    [bookingId, navigation],
  );

  /** The shared sheet's "Yes, Cancel Trip": cancels with the chosen chip's label as the reason. */
  const onCancelConfirm = useCallback(
    (reason?: string) => {
      cancelBooking.mutate(
        { bookingId, reason },
        {
          onSuccess: () => {
            setCancelOpen(false);
            goHome();
          },
          onError: () => {
            setCancelOpen(false);
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

  // --- Figma geometry ------------------------------------------------------

  const [screenHeight, setScreenHeight] = useState(windowHeight);
  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    setScreenHeight(e.nativeEvent.layout.height);
  }, []);

  /** A drawn bottom space that includes the 34 home-indicator zone, grown by a taller inset. */
  const bottomSpace = (drawn: number) =>
    Math.max(drawn, drawn - DESIGN_BOTTOM_INSET + insets.bottom);

  /** The legacy sheet is not measured: its map sizes itself from the snap points. */
  const sheet: SheetDesign | null = showCode ? 'code24' : design === 'legacy' ? null : design;

  /** Each sheet's drawn height, grown by a taller bottom inset. */
  const drawnSheetHeight = (which: SheetDesign | null): number => {
    switch (which) {
      case 'arriving19':
        return ARRIVING_CONTENT_HEIGHT + bottomSpace(ARRIVING_BOTTOM_SPACE);
      case 'arrived23':
        return ARRIVED_CONTENT_HEIGHT + bottomSpace(ARRIVED_BOTTOM_SPACE);
      case 'code24':
        return CODE_CONTENT_HEIGHT + bottomSpace(CODE_BOTTOM_SPACE);
      case 'inTransit25':
        return IN_TRANSIT_CONTENT_HEIGHT + bottomSpace(IN_TRANSIT_BOTTOM_SPACE);
      default:
        return SHEET_CONTENT_HEIGHT + bottomSpace(EN_ROUTE_BOTTOM_SPACE);
    }
  };

  /**
   * The sheet's height as `onLayout` measured it, TAGGED WITH THE SHEET IT
   * MEASURED. A bare number still holds the previous sheet's height on the first
   * render of the next one (18 → 19 would read 18's 441.2 against 19's 474.1),
   * so the map would frame the new step against the old, taller map, and the
   * controls would flash at the old positions. Until the new sheet has measured
   * itself, its drawn height stands in.
   */
  const [measured, setMeasured] = useState<{ sheet: SheetDesign; height: number } | null>(null);
  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (sheet) setMeasured({ sheet, height: e.nativeEvent.layout.height });
    },
    [sheet],
  );
  const sheetHeight =
    measured !== null && measured.sheet === sheet ? measured.height : drawnSheetHeight(sheet);
  const sheetTop = screenHeight - sheetHeight;

  /** Back at y 49 and Help at 48.5 as drawn; only a taller Android status bar pushes them down. */
  const controlsTop =
    Platform.OS === 'android'
      ? Math.max(mitowLayout.contentTop, insets.top)
      : mitowLayout.contentTop;

  const legacySnapPoints = useMemo(
    () => [windowHeight * PEEK_RATIO, windowHeight * DEFAULT_RATIO, windowHeight * FULL_RATIO],
    [windowHeight],
  );
  const legacyInset = windowHeight * PEEK_RATIO;

  const driver = displayDriver(tracking);
  const firstName = firstNameOf(driver?.name);

  const mapVariant: TrackingMapVariant = showCode
    ? 'code'
    : design === 'enRoute18'
      ? 'enRoute'
      : design === 'arriving19'
        ? 'arriving'
        : design === 'arrived23'
          ? 'arrived'
          : design === 'inTransit25'
            ? 'inTransit'
            : 'legacy';

  /**
   * 18, 19, 23 and 25 share one FixedSheet instance, so the blocks they share
   * carry STABLE KEYS: without them React matches children by position, and a
   * block that moves down a slot (19's Safe hands banner, below the timeline 18
   * does not have) would remount on the 18 → 19 switch.
   */
  const driverRow = (
    <DriverRow key="driver" driver={driver} onCall={onCall} onMessage={onMessage} />
  );
  const vehicleCard = (
    <VehicleCard
      key="vehicle"
      plate={vehiclePlateLabel(driver)}
      model={vehicleModelLabel(driver)}
      onPress={openBookingDetails}
    />
  );

  return (
    <View onLayout={onRootLayout} style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}>
      <StatusBar style="dark" />

      <TrackingMap
        tracking={tripTracking}
        presence={presence}
        variant={mapVariant}
        sheetTop={sheetTop}
        bottomInset={legacyInset}
        driverChipLabel={firstName ? `${firstName} is here` : null}
      />

      {/* Back (18 `229:269`, 19 `254:1516`, 23 `236:373`, 24 `299:4110`, 25 `236:460`): Map Control 46 at (16, 49). */}
      <MiMapButton
        icon="chevron-left"
        size={46}
        accessibilityLabel="Go back"
        onPress={showCode ? closeCode : goBack}
        style={{ position: 'absolute', left: 16, top: controlsTop }}
      />
      {/*
        Help: 18, 19, 23 and 25 (`236:466`) draw it at (284.8, 48.5), 13.2 from
        the right edge; 24 `299:4116` at (285, 49), 13 from it. 25's opens 26
        Emergency, every other one 58 Support.
      */}
      <MiHelpChip
        onPress={design === 'inTransit25' ? openEmergency : openSupport}
        style={
          showCode
            ? { position: 'absolute', right: 13, top: controlsTop }
            : { position: 'absolute', right: 13.2, top: controlsTop - 0.5 }
        }
      />

      {design === 'enRoute18' ? (
        <FixedSheet
          onLayout={onSheetLayout}
          paddingTop={10.1}
          paddingBottom={bottomSpace(EN_ROUTE_BOTTOM_SPACE)}
          gap={18}
        >
          <Grabber key="grabber" />

          {/*
            All four blocks are always drawn, so the sheet keeps its drawn height
            (top edge at 410.8) from the first frame. Slots whose data has not
            arrived keep their size with a placeholder bar.
          */}
          <LiveEtaCard key="heading" tracking={tracking} />
          {driverRow}
          {vehicleCard}
          {/* Safe hands banner `226:346`: 71.1 tall, padding 11 / 8. */}
          <SafeHandsBanner key="safe-hands" height={71.1} paddingLeft={11} />
        </FixedSheet>
      ) : design === 'arriving19' ? (
        <FixedSheet
          onLayout={onSheetLayout}
          paddingTop={14}
          paddingBottom={bottomSpace(ARRIVING_BOTTOM_SPACE)}
          gap={16}
        >
          <Grabber key="grabber" />
          <StaticTripHeading key="heading" title={ARRIVING_TITLE} subtitle={ARRIVING_SUBTITLE} />
          {driverRow}
          {vehicleCard}
          <ArrivalTimeline key="timeline" tracking={tracking} />
          {/* Safe hands banner `254:1505`: 71 tall, padding 8 / 8 (the component's own). */}
          <SafeHandsBanner key="safe-hands" height={71} paddingLeft={8} />
        </FixedSheet>
      ) : design === 'arrived23' && !showCode ? (
        <FixedSheet
          onLayout={onSheetLayout}
          paddingTop={14}
          paddingBottom={bottomSpace(ARRIVED_BOTTOM_SPACE)}
          gap={16}
        >
          <Grabber key="grabber" />
          <StaticTripHeading key="heading" title={ARRIVED_TITLE} subtitle={ARRIVED_SUBTITLE} />
          {driverRow}
          {vehicleCard}
          {/* Verified banner `236:360`: Info Banner 75 tall, padding 8 / 8, no chevron. */}
          <MiInfoBanner
            key="verified"
            icon="verified"
            iconSize={49}
            title={VERIFIED_TITLE}
            subtitle={VERIFIED_SUBTITLE}
            height={75}
          />
          {/*
            Confirm Pickup `236:369`: Primary Button 351.4 × 54.3, 21.4 below the
            banner (the 16 gap + 5.4), 0.4 wider than the content column on the
            right, as drawn. Opens 24.
          */}
          <MiButton
            key="confirm-pickup"
            label={CONFIRM_PICKUP}
            trailingIcon="arrow-right"
            height={54.3}
            onPress={openCode}
            style={{ marginTop: 5.4, marginRight: -0.4 }}
          />
        </FixedSheet>
      ) : design === 'inTransit25' ? (
        /*
          25's sheet `236:403`: fixed 463.6 as drawn, padding 13.7 / 20.4 / 0 / 21.6,
          gap 18; the 68.4 of empty sheet under the banner (the home-indicator
          zone included) is its bottom space.
        */
        <FixedSheet
          onLayout={onSheetLayout}
          paddingTop={13.7}
          paddingBottom={bottomSpace(IN_TRANSIT_BOTTOM_SPACE)}
          gap={18}
        >
          <Grabber key="grabber" />
          <StaticTripHeading key="heading" title={ARRIVING_TITLE} subtitle={IN_TRANSIT_SUBTITLE} />
          <TripTimeline
            key="trip-timeline"
            tracking={tripTracking}
            pickupAddress={booking?.originLabel}
            dropAddress={booking?.destinationLabel}
          />
          <EtaBanner key="eta" tracking={tripTracking} />
        </FixedSheet>
      ) : showCode ? (
        /*
          24's sheet `299:4128` is exactly MiSheetPanel's defaults: handle 36 × 5,
          padding 14 / 21 / 34 / 21, gap 16, hugging its content.
        */
        <View
          onLayout={onSheetLayout}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        >
          <MiSheetPanel>
            <CodeHeading firstName={firstName} />
            {driverRow}
            <CollectionCodeCard code={collectionCode} />
          </MiSheetPanel>
        </View>
      ) : (
        <BottomSheet snapPoints={legacySnapPoints} initialIndex={1}>
          <LegacySheetContent
            bookingId={bookingId}
            tracking={tracking}
            presence={presence}
            status={status}
            otpAvailable={booking?.otpAvailable ?? false}
            sharePending={shareTrip.isPending}
            onGetHelp={openSupport}
            onCall={onCall}
            onMessage={onMessage}
            onVehicle={openBookingDetails}
            onShare={onShare}
            onStopSharing={onStopSharing}
            onCancel={() => setCancelOpen(true)}
          />
        </BottomSheet>
      )}

      {/* The legacy sheet's "Cancel trip". */}
      <CancelTripSheet
        bookingId={bookingId}
        visible={cancelOpen}
        onDismiss={() => setCancelOpen(false)}
        onConfirm={onCancelConfirm}
        isCancelling={cancelBooking.isPending}
      />
    </View>
  );
}

/**
 * The fixed, non-draggable sheet of 18, 19, 23 and 25: pinned to the bottom,
 * surface/page, top corners 24, MiTow/Elevation/Sheet, left 21.6 / right 20.4.
 * Its height is its content, measured for the map and the map controls.
 */
function FixedSheet({
  children,
  onLayout,
  paddingTop,
  paddingBottom,
  gap,
}: {
  children: React.ReactNode;
  onLayout: (e: LayoutChangeEvent) => void;
  paddingTop: number;
  paddingBottom: number;
  gap: number;
}) {
  return (
    <View
      onLayout={onLayout}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: mitowColors.surfacePage,
        borderTopLeftRadius: mitowRadii.sheet,
        borderTopRightRadius: mitowRadii.sheet,
        ...mitowShadows.sheet,
        paddingTop,
        paddingLeft: 21.6,
        paddingRight: 20.4,
        paddingBottom,
        gap,
      }}
    >
      {children}
    </View>
  );
}

/** Handle / Grabber (18 `226:318`, 19 `254:1455`, 23 `236:333`, 25 `236:405`): 50 × 5, radius 2.5, border/handle, centred. */
function Grabber() {
  return (
    <View style={{ height: 5, alignItems: 'center' }}>
      <View
        style={{
          width: 50,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: mitowColors.borderHandle,
        }}
      />
    </View>
  );
}

/** Driver (18 `234:315`, 19 `254:1459`, 23 `236:337`, 24 `299:4134`): the Driver Row bound to the tracked driver. */
function DriverRow({
  driver,
  onCall,
  onMessage,
}: {
  driver: TrackedDriverDisplay | null;
  onCall: () => void;
  onMessage: () => void;
}) {
  return (
    <DriverInfoCard
      driver={driver ? { name: driver.name, photoUrl: driver.photoUrl } : null}
      ratingText={driver ? ratingLabel(driver.rating, driver.totalTrips) : null}
      onCall={onCall}
      onMessage={onMessage}
    />
  );
}

/**
 * Safe hands banner: Info Banner, icon/color/verified 49, no chevron, "You're in
 * safe hands". 18 `226:346` overrides it to 71.1 tall with padding 11 / 8; 19
 * `254:1505` draws 71 with the component's own 8 / 8.
 */
function SafeHandsBanner({ height, paddingLeft }: { height: number; paddingLeft: number }) {
  return (
    <MiInfoBanner
      icon="verified"
      iconSize={49}
      title={SAFE_TITLE}
      subtitle={SAFE_SUBTITLE}
      height={height}
      paddingLeft={paddingLeft}
      paddingRight={8}
    />
  );
}

/**
 * The pre-redesign sheet, kept for the statuses no rebuilt screen draws: a
 * re-dispatch after the driver drops out (`searching`, then possibly
 * `no_drivers_found`) and `disputed` (data gap). Its shared blocks use the
 * rebuilt components.
 */
function LegacySheetContent({
  bookingId,
  tracking,
  presence,
  status,
  otpAvailable,
  sharePending,
  onGetHelp,
  onCall,
  onMessage,
  onVehicle,
  onShare,
  onStopSharing,
  onCancel,
}: {
  bookingId: string;
  tracking: BookingTracking | undefined;
  presence: 'live' | 'stale' | 'offline';
  status: BookingTracking['status'] | undefined;
  otpAvailable: boolean;
  sharePending: boolean;
  onGetHelp: () => void;
  onCall: () => void;
  onMessage: () => void;
  onVehicle: () => void;
  onShare: () => void;
  onStopSharing: () => void;
  onCancel: () => void;
}) {
  const driver = displayDriver(tracking);

  return (
    <View
      style={{
        paddingHorizontal: mitowLayout.sideMargin,
        paddingTop: 8,
        paddingBottom: 28,
        gap: 18,
      }}
    >
      <ConnectionBanner presence={presence} onGetHelp={onGetHelp} />

      {tracking ? <LiveEtaCard tracking={tracking} /> : null}

      {driver ? <DriverRow driver={driver} onCall={onCall} onMessage={onMessage} /> : null}

      {driver ? (
        <VehicleCard
          plate={vehiclePlateLabel(driver)}
          model={vehicleModelLabel(driver)}
          onPress={onVehicle}
        />
      ) : null}

      <BookingOtpCard
        bookingId={bookingId}
        available={otpAvailable}
        highlighted={status === 'arrived'}
      />

      <SafeHandsBanner height={71.1} paddingLeft={11} />

      {driver && tracking ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <MiButton
              tone="quiet"
              onPress={onShare}
              disabled={sharePending}
              accessibilityLabel="Share this trip"
              label={sharePending ? 'Creating link…' : 'Share trip'}
            />
          </View>
          {tracking.shared ? <StopSharing onPress={onStopSharing} /> : null}
        </View>
      ) : null}

      {status && hasTimelinePosition(status) ? (
        <MiCard padding={16}>
          <StatusTimeline status={status} />
        </MiCard>
      ) : null}

      {status && !['completed', 'paid', 'cancelled'].includes(status) ? (
        <MiButton
          tone="outline"
          onPress={onCancel}
          accessibilityLabel="Cancel this trip"
          label="Cancel trip"
        />
      ) : null}
    </View>
  );
}

function StopSharing({ onPress }: { onPress: () => void }) {
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={1}
      haptic="light"
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Stop sharing this trip"
    >
      <MiText variant="strong14" color="brand">
        Stop sharing
      </MiText>
    </Pressable>
  );
}

/** Terminal statuses, from this screen's point of view. */
function isSettled(status: string | undefined): boolean {
  return status === 'completed' || status === 'paid' || status === 'cancelled';
}
