import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { MapPreview, type MapRegion } from '@towing/ui';
import { mitowColors, mitowLayout, MiHelpChip } from '@/design';
import { ApiClientError } from '@/lib/api/errors';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { useSearchProgress } from '@/features/booking/hooks/useSearchProgress';
import {
  useBooking,
  useCancelBooking,
  useRetrySearch, CancellationFeeNotPaidError } from '@/features/bookings/api/bookings.queries';
import { bookingsKeys } from '@/features/bookings/api/bookings.keys';
import type { BookingStatus } from '@/features/bookings/types';
import type { RootStackParamList } from '@/navigation/types';
import { NoTrucksCallout } from './searching/NoTrucksCallout';
import { SearchingSheet, type SearchingSheetProps } from './searching/SearchingSheet';

/**
 * Figma 16 · Searching for Tow (`291:2234`) and 17 · No Drivers Found
 * (`291:2285`): one route, two drawn frames, picked by the booking's status.
 *
 * Both frames: a live map from the very top of the screen (under a transparent,
 * dark-content status bar) down to 30 pt below the sheet's top edge; the Help
 * chip floating 49 from the top and 13 from the right; the bottom sheet flush
 * with the screen bottom. 17 adds the fixed "No tow trucks nearby" callout.
 * Nothing else is drawn on the map (no markers, route, user dot or controls).
 *
 * Flow: a driver accepting hands straight off to 18 Driver En Route (the design
 * draws no "driver found" moment). Help and Get Help open 58 Support. Cancel
 * Request cancels the booking and returns Home. Try Again re-searches the same
 * booking, which puts it back on frame 16.
 */

/** The sheet overlaps the bottom 30 pt of the map (sheet top 433, map ends 463). */
const MAP_UNDER_SHEET = 30;
/** Help chip x 285 on the 393 frame: 13 from the right edge. */
const HELP_RIGHT = 13;
/** Street-level framing around the pickup. The design draws no camera; see data gaps. */
const MAP_ZOOM_DELTA = 0.022;

/** A driver has accepted (or the trip has moved on since): 18 Driver En Route takes over. */
const HANDOFF_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'paid',
  'disputed',
]);

type SearchingFrame = SearchingSheetProps['state'];

export function SearchingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'Searching'>>().params;
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: booking, isPending: bookingPending } = useBooking(bookingId, { poll: true });
  const cancelBooking = useCancelBooking();
  const retrySearch = useRetrySearch();

  const pickupAddress = useBookingStore((s) => s.pickupAddress);
  const dropAddress = useBookingStore((s) => s.dropAddress);
  const pickupCoords = useBookingStore((s) => s.pickupCoords);

  // §9.1.6's real wave state: the socket when connected, the 10 s poll otherwise.
  const progress = useSearchProgress(bookingId, booking?.search);

  /**
   * Which drawn frame. 17 only for a search that really ended with nobody
   * accepting, 16 for a live search. While the booking's status is not known
   * yet (a cold cache) neither frame is claimed: showing 16 and then flipping
   * to 17 would draw a search that is not happening. A failed or empty load
   * falls back to 16 so Cancel Request and Help stay reachable.
   */
  const status = booking?.status;
  const frame: SearchingFrame | null =
    status === 'no_drivers_found'
      ? 'noDrivers'
      : status === 'searching'
        ? 'searching'
        : bookingPending
          ? null
          : 'searching';

  /**
   * Leaving this screen happens once. A driver accepting hands off to 18 with
   * Home underneath; a booking cancelled from anywhere (this screen, another
   * device, the server) goes Home, because there is no search left to show.
   */
  const left = useRef(false);
  const goHome = useCallback(() => {
    if (left.current) return;
    left.current = true;
    navigation.popToTop();
  }, [navigation]);

  useEffect(() => {
    if (!status || left.current) return;
    if (HANDOFF_STATUSES.has(status)) {
      left.current = true;
      navigation.reset({
        index: 1,
        routes: [{ name: 'Tabs' }, { name: 'Tracking', params: { bookingId } }],
      });
      return;
    }
    if (status === 'cancelled') goHome();
  }, [status, navigation, bookingId, goHome]);

  const openSupport = useCallback(() => navigation.navigate('Support'), [navigation]);

  /**
   * §9.1.6 "Cancel — free" during search. The design draws no loading, disabled
   * or error state, so a second tap while the request is out is ignored rather
   * than spun, the customer goes Home only once the cancel has really happened,
   * and a refusal is reported in a system alert (as 14's Confirm Booking does)
   * instead of silently leaving a live booking behind.
   */
  const cancelPending = cancelBooking.isPending;
  const onCancelRequest = useCallback(() => {
    if (cancelPending) return;
    cancelBooking.mutate(
      { bookingId, reason: 'Cancelled during search' },
      {
        onSuccess: goHome,
        onError: (error) => {
          // A driver can be matched between the tap and the cancel, making it
          // chargeable; closing that fee's sheet is a choice, not a failure.
          if (error instanceof CancellationFeeNotPaidError) return;
          Alert.alert('Cancel Request', cancelMessage(error));
        },
      },
    );
  }, [cancelPending, cancelBooking, bookingId, goHome]);

  /**
   * §9.1.6 "retry / widen": re-searches the SAME booking, keeping its locked
   * fare. The server's answer is written straight into the booking cache, so
   * the screen returns to 16 the moment the retry is accepted rather than on
   * the refetch after it. A refusal is reported in a system alert and 17 stays.
   */
  const retryPending = retrySearch.isPending;
  const onTryAgain = useCallback(() => {
    if (retryPending) return;
    retrySearch.mutate(bookingId, {
      onSuccess: (detail) => queryClient.setQueryData(bookingsKeys.detail(bookingId), detail),
      onError: (error) => Alert.alert('Try Again', retryMessage(error)),
    });
  }, [retryPending, retrySearch, bookingId, queryClient]);

  // The camera is uncontrolled after mount, so the region is read once.
  const [initialRegion] = useState<MapRegion>(() => ({
    latitude: pickupCoords.latitude,
    longitude: pickupCoords.longitude,
    latitudeDelta: MAP_ZOOM_DELTA,
    longitudeDelta: MAP_ZOOM_DELTA,
  }));

  // 49 from the top of the screen as drawn; only a taller Android status bar pushes it down.
  const helpTop =
    Platform.OS === 'android'
      ? Math.max(mitowLayout.contentTop, insets.top)
      : mitowLayout.contentTop;

  // This booking's own labels first (what was actually booked), the draft while it loads.
  const pickup = booking?.originLabel || pickupAddress;
  const drop = booking?.destinationLabel || dropAddress;

  return (
    <View style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}>
      {/* Edge-to-edge: the bar is already transparent, drawn over the map. */}
      <StatusBar style="dark" />

      {/*
        The map fills everything above the sheet plus the 30 pt the sheet
        overlaps. Laid out in the same pass as the sheet (flex with a negative
        margin, not a measured height), so it mounts at its final size: no
        full-screen first frame and no camera shift when the sheet measures.
        `label=""` keeps the placeholder's "MAP" watermark off a build that has
        no Android Maps key; with the key this is always the real map.
      */}
      <MapPreview
        style={{ flex: 1, marginBottom: -MAP_UNDER_SHEET }}
        initialRegion={initialRegion}
        showRecenter={false}
        showUserLocation={false}
        userLocationLabel=""
        label=""
        mapPadding={{ bottom: MAP_UNDER_SHEET }}
      />

      {frame === 'noDrivers' ? <NoTrucksCallout /> : null}

      <View
        pointerEvents={frame ? 'auto' : 'none'}
        accessibilityElementsHidden={!frame}
        importantForAccessibility={frame ? 'auto' : 'no-hide-descendants'}
        style={{ opacity: frame ? 1 : 0 }}
      >
        <SearchingSheet
          state={frame ?? 'searching'}
          progress={progress}
          pickup={pickup}
          drop={drop}
          onCancelRequest={onCancelRequest}
          onGetHelp={openSupport}
          onTryAgain={onTryAgain}
        />
      </View>

      <MiHelpChip
        onPress={openSupport}
        style={{ position: 'absolute', top: helpTop, right: HELP_RIGHT }}
      />
    </View>
  );
}

/**
 * The server's own refusal when it gave one (an enveloped 4xx carries a sentence
 * meant for the customer); otherwise a plain retry prompt rather than
 * "Request failed (500)".
 */
function refusalMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiClientError &&
    error.status < 500 &&
    error.code !== 'internal_error' &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}

function cancelMessage(error: unknown): string {
  return refusalMessage(error, 'We could not cancel your request. Please try again.');
}

function retryMessage(error: unknown): string {
  return refusalMessage(error, 'We could not restart the search. Please try again in a moment.');
}
