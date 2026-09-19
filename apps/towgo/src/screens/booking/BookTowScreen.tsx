import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PricingEstimateRequest } from '@towing/api-contracts';
import {
  MapPreview,
  type MapCoordinate,
  type MapPreviewController,
  type MapRegion,
} from '@towing/ui';
import {
  mitowColors,
  mitowLayout,
  MiButton,
  MiMapButton,
  MiMapCallout,
  MiSheetPanel,
  MiText,
} from '@/design';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { towTypes, vehicleClassFor } from '@/features/booking/data/towTypes.data';
import { useFareEstimate, usePrefetchFareEstimates } from '@/features/booking/api/pricing.queries';
import { useServices } from '@/features/services/api/services.queries';
import { FareBreakdownSheet } from '@/features/booking/components/FareBreakdownSheet';
import { TowTypeCarousel } from '@/features/booking/components/TowTypeCarousel';
import { RouteSummaryPill } from '@/features/booking/components/book-a-tow/RouteSummaryPill';
import { NotesSection } from '@/features/booking/components/book-a-tow/NotesField';
import { EstimatedFareRow } from '@/features/booking/components/book-a-tow/EstimatedFareRow';
import {
  routeCalloutText,
  routeFacts,
  straightLineRoute,
} from '@/features/booking/components/book-a-tow/routeCopy';
import { useCreateBooking } from '@/features/bookings/api/bookings.queries';
import { track } from '@/lib/analytics/analytics';
import { ApiClientError } from '@/lib/api/errors';
import type { RootStackParamList } from '@/navigation/types';

/** Figma 14 geometry, on the 393 × 852 frame. */
const SIDE_INSET = 16;
const BACK_SIZE = 46;
const RECENTER_SIZE = 50;
/** Back / pill top (49) to the callout bubble's top (126). */
const CALLOUT_BELOW_CONTROLS = 77;
/** Recenter bottom (368) sits 16 above the sheet top (384). */
const RECENTER_ABOVE_SHEET = 16;

/**
 * Figma 14 · Book a Tow (`258:1515`), with 15 · Fare Breakdown (`292:2546`) as a
 * modal sheet over it.
 *
 * Back to front: a live Google map, the Back button + route summary pill at y 49,
 * the dark route callout, the Recenter button 16 above the sheet, and the
 * bottom sheet (Select Vehicle, Additional Notes, Estimated Fare, Confirm
 * Booking), which hugs its content and is anchored to the bottom edge. The design
 * draws no pins, route line, map chips, title or tab bar, so none are rendered.
 *
 * The design draws one state, fully populated. So nothing drawn waits on the
 * network: the callout reads the booking's own route until a quote lands, the
 * fare row holds the quote on screen through a re-quote, and no control is ever
 * disabled.
 */
export function BookTowScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const towTypeId = useBookingStore((s) => s.towTypeId);
  const serviceSlug = useBookingStore((s) => s.serviceSlug);
  const pickupCoords = useBookingStore((s) => s.pickupCoords);
  const dropCoords = useBookingStore((s) => s.dropCoords);
  const pickupAddress = useBookingStore((s) => s.pickupAddress);
  const dropAddress = useBookingStore((s) => s.dropAddress);
  const note = useBookingStore((s) => s.note);
  const scheduledAt = useBookingStore((s) => s.scheduledAt);
  const contact = useBookingStore((s) => s.contact);
  const setNote = useBookingStore((s) => s.setNote);

  const { data: services } = useServices();
  const service = services?.find((item) => item.slug === serviceSlug);
  // Until the catalogue lands, assume a tow needs a drop. Assuming the opposite
  // would fire an estimate that the server answers with a 422.
  const requiresDrop = service?.requiresDrop ?? true;
  const vehicleClass = service?.defaultVehicleClass ?? vehicleClassFor(towTypeId);

  /**
   * §7.6's request for a given class. `undefined` until there is something
   * real to price, which keeps `useFareEstimate` disabled. The class follows
   * the selected card unless the catalogue row pins one.
   */
  const requestFor = useCallback(
    (klass: 'wheel_lift' | 'flatbed'): PricingEstimateRequest | undefined => {
      if (requiresDrop && !dropCoords) return undefined;
      return {
        serviceSlug,
        vehicleClass: klass,
        pickup: { lat: pickupCoords.latitude, lng: pickupCoords.longitude },
        ...(dropCoords ? { drop: { lat: dropCoords.latitude, lng: dropCoords.longitude } } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
      };
    },
    [requiresDrop, dropCoords, serviceSlug, pickupCoords, scheduledAt],
  );

  const estimateInput = useMemo(() => requestFor(vehicleClass), [requestFor, vehicleClass]);
  const estimate = useFareEstimate(estimateInput, requiresDrop);

  // The other tiles' quotes, so a tile switch swaps the fare at once. A
  // catalogue row that pins the class has no other quote to warm.
  const alternateInputs = useMemo(() => {
    if (service?.defaultVehicleClass) return [];
    const classes = new Set(towTypes.map((type) => type.vehicleClass));
    classes.delete(vehicleClass);
    return [...classes]
      .map((klass) => requestFor(klass))
      .filter((input): input is PricingEstimateRequest => Boolean(input));
  }, [service?.defaultVehicleClass, vehicleClass, requestFor]);
  usePrefetchFareEstimates(alternateInputs, Boolean(estimateInput));

  // §22.1: emitted when a fare for the current request lands, not for the
  // previous vehicle's quote held on screen meanwhile.
  useEffect(() => {
    if (estimate.data && !estimate.isPlaceholderData) track('estimate_viewed');
  }, [estimate.data, estimate.isPlaceholderData]);

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  /** The row opens 15 once a quote is on screen; before that it asks for one again. */
  const onFarePress = useCallback(() => {
    if (estimate.data) {
      setBreakdownOpen(true);
      return;
    }
    // Nothing to price without a drop (10 does not let one through without it).
    if (!estimateInput) return;
    void estimate.refetch({ cancelRefetch: false }).then((result) => {
      if (result.data) setBreakdownOpen(true);
    });
  }, [estimate, estimateInput]);

  // --- route numbers ----------------------------------------------------------

  const preview = useMemo(
    () => straightLineRoute(pickupCoords, dropCoords),
    [pickupCoords, dropCoords],
  );
  const route = routeFacts(estimate.data, preview);

  // --- confirm ----------------------------------------------------------------

  const createBooking = useCreateBooking();
  const confirming = useRef(false);

  /**
   * §3.4's confirm, the real POST. `replace`, so "back" from Searching cannot
   * offer to create a second booking.
   *
   * The design draws no disabled, in-progress or error state for the button, so
   * it is never disabled. A tap while the quote for the selected vehicle is
   * still out waits for it (the fare the customer confirms is on screen by the
   * time the booking is created); a tap with no quote at all asks for it again.
   * A refusal is reported in a system alert, which adds nothing to the drawn
   * screen.
   */
  const confirmBooking = useCallback(async () => {
    if (createBooking.isPending || confirming.current) return;
    if (!estimateInput) {
      // No drop to tow to: the only way on is to set one on 10 Enter Location.
      navigation.popTo('BookLocation');
      return;
    }

    confirming.current = true;
    try {
      if (!estimate.data || estimate.isPlaceholderData) {
        const result = await estimate.refetch({ cancelRefetch: false });
        if (!result.data || result.isPlaceholderData) {
          Alert.alert(
            'Confirm Booking',
            'We could not get a fare for this trip. Please try again.',
          );
          return;
        }
      }

      createBooking.mutate(
        {
          serviceSlug: estimateInput.serviceSlug,
          vehicleClass: estimateInput.vehicleClass,
          pickup: estimateInput.pickup,
          pickupAddress: pickupAddress || 'Pickup location',
          ...(estimateInput.drop
            ? { drop: estimateInput.drop, dropAddress: dropAddress || 'Drop location' }
            : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(contact ? { contact } : {}),
        },
        {
          onSuccess: (booking) => {
            track('booking_confirmed');
            navigation.replace('Searching', { bookingId: booking.id });
          },
          onError: (error) => {
            Alert.alert('Confirm Booking', confirmMessage(error));
          },
        },
      );
    } finally {
      confirming.current = false;
    }
  }, [
    estimateInput,
    estimate,
    createBooking,
    pickupAddress,
    dropAddress,
    scheduledAt,
    note,
    contact,
    navigation,
  ]);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);
  // "Edit" returns to 10 Enter Location, popping 13 if it sits in between.
  const editRoute = useCallback(() => navigation.popTo('BookLocation'), [navigation]);

  // --- layout ---------------------------------------------------------------

  const controlsTop = Math.max(mitowLayout.contentTop, insets.top);
  /** The sheet itself, for the map padding. */
  const [sheetHeight, setSheetHeight] = useState(0);
  const onSheetLayout = useCallback((event: LayoutChangeEvent) => {
    setSheetHeight(Math.round(event.nativeEvent.layout.height));
  }, []);
  /**
   * The keyboard-avoiding wrapper, whose top IS the sheet's top whether or not
   * the keyboard has lifted the sheet for the Notes field. Recenter rides it.
   */
  const [sheetTopFromBottom, setSheetTopFromBottom] = useState(0);
  const onSheetWrapperLayout = useCallback((event: LayoutChangeEvent) => {
    setSheetTopFromBottom(Math.round(event.nativeEvent.layout.height));
  }, []);

  // --- map ------------------------------------------------------------------

  const map = useRef<MapPreviewController>(null);
  const routePoints = useMemo<MapCoordinate[]>(
    () => (dropCoords ? [pickupCoords, dropCoords] : [pickupCoords]),
    [pickupCoords, dropCoords],
  );
  const initialRegion = useMemo(() => regionAround(routePoints), [routePoints]);

  /** Recenter: frame pickup and drop again, undoing any pan or zoom. Never moves either point. */
  const recenter = useCallback(() => {
    if (routePoints.length > 1) {
      map.current?.fitToCoordinates(routePoints, {
        // `mapPadding` already keeps the camera clear of the top controls and
        // the sheet; this is only breathing room inside that viewport.
        padding: { top: 48, bottom: 48, left: 48, right: 48 },
        animated: true,
      });
    } else {
      map.current?.animateToCoordinate(routePoints[0]!);
    }
  }, [routePoints]);

  const vehicleName = towTypes.find((type) => type.id === towTypeId)?.name ?? towTypes[0]!.name;

  return (
    <View style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}>
      <StatusBar style="dark" />

      <MapPreview
        style={StyleSheet.absoluteFill}
        showRecenter={false}
        showUserLocation={false}
        label=""
        controllerRef={map}
        initialRegion={initialRegion}
        mapPadding={{
          top: controlsTop + BACK_SIZE,
          // The sheet covers the map's lower edge; the map itself runs on under the
          // sheet's rounded top (the design's map ends 30 below the sheet top).
          bottom: sheetHeight,
        }}
        onMapReady={recenter}
      />

      {/* E4 Route callout, always drawn: fixed on screen, bubble centred on the frame (142 + 110 / 2 = 196.5). */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: controlsTop + CALLOUT_BELOW_CONTROLS,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <MiMapCallout tail="bottomLeft" width="auto" text={routeCalloutText(route)} />
      </View>

      {/* E2 Back + E3 Route summary pill at y 49, 16 side insets, gap 10. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: controlsTop,
          left: SIDE_INSET,
          right: SIDE_INSET,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <MiMapButton
          icon="chevron-left"
          size={BACK_SIZE}
          onPress={goBack}
          accessibilityLabel="Go back"
        />
        <RouteSummaryPill pickup={pickupAddress} drop={dropAddress} onEdit={editRoute} />
      </View>

      {/* E5 Recenter, 16 above the sheet's top edge (also while the keyboard lifts the sheet). */}
      {sheetTopFromBottom > 0 ? (
        <MiMapButton
          icon="navigation"
          size={RECENTER_SIZE}
          onPress={recenter}
          accessibilityLabel="Recenter"
          style={{
            position: 'absolute',
            right: SIDE_INSET,
            bottom: sheetTopFromBottom + RECENTER_ABOVE_SHEET,
          }}
        />
      ) : null}

      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        onLayout={onSheetWrapperLayout}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
      >
        <View onLayout={onSheetLayout}>
          <MiSheetPanel>
            <View style={{ gap: mitowLayout.headingGap }}>
              <MiText variant="heading18">Select Vehicle</MiText>
              <TowTypeCarousel />
            </View>

            <NotesSection note={note} onChangeNote={setNote} />

            <EstimatedFareRow estimate={estimate.data} onPress={onFarePress} />

            <MiButton tone="yellow" label="Confirm Booking" onPress={() => void confirmBooking()} />
          </MiSheetPanel>
        </View>
      </KeyboardAvoidingView>

      <FareBreakdownSheet
        visible={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        estimate={estimate.data}
        vehicleName={vehicleName}
        vehicleClass={vehicleClass}
        route={route}
      />
    </View>
  );
}

/** A region that holds every point with some margin; ~2 km around a single point. */
function regionAround(points: MapCoordinate[]): MapRegion {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.8, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.8, 0.02),
  };
}

/**
 * §3.8's guards, in the customer's words. Branches on `error.code`, the stable
 * contract, rather than the message.
 */
function confirmMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return 'We could not confirm your booking. Please try again.';
  }
  switch (error.code) {
    case 'active_booking_exists':
      return 'You already have a trip in progress. Open it from My Bookings.';
    case 'unpaid_balance':
      return 'Please settle your previous trip before booking again.';
    case 'account_not_active':
      return 'This account cannot book right now. Please contact support.';
    case 'outside_service_area':
      return 'We do not operate at that pickup location yet.';
    default:
      return error.message || 'We could not confirm your booking. Please try again.';
  }
}
