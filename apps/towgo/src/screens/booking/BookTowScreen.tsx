import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useTheme } from '@towing/theme';
import { Text, MapPreview } from '@towing/ui';
import { LocateFixed, StickyNote, ChevronRight } from '@/icons';
import { BackButton } from '@/components/BackButton';
import { useLocationStore } from '@/features/location/locationStore';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { vehicleClassFor } from '@/features/booking/data/towTypes.data';
import { useFareEstimate } from '@/features/booking/api/pricing.queries';
import { ManualQuoteBar } from '@/features/quotes/components/ManualQuoteBar';
import { RequestQuoteSheet } from '@/features/quotes/components/RequestQuoteSheet';
import { useRequestQuote } from '@/features/quotes/api/quotes.queries';
import { useServices } from '@/features/services/api/services.queries';
import { FareBreakdownSheet } from '@/features/booking/components/FareBreakdownSheet';
import { NoteEditorSheet } from '@/features/booking/components/BookingExtrasSheets';
import { track } from '@/lib/analytics/analytics';
import { useCreateBooking } from '@/features/bookings/api/bookings.queries';
import { ApiClientError } from '@/lib/api/errors';
import { LocationSummaryBar } from '@/features/booking/components/LocationSummaryBar';
import { MapRouteOverlay } from '@/features/booking/components/MapRouteOverlay';
import { TowTypeCarousel } from '@/features/booking/components/TowTypeCarousel';
import { BookingOptionRow } from '@/features/booking/components/BookingOptionRow';
import { BookingBottomBar } from '@/features/booking/components/BookingBottomBar';
import { TrustBanner } from '@/features/booking/components/TrustBanner';
import type { RootStackParamList } from '@/navigation/types';
import { Pressable, BottomSheet } from '@/motion';

/**
 * Two snaps, not three. Collapsed shows the heading, one row of tow types and
 * the CTA; expanded matches the 72% the static sheet used, so the first paint
 * is unchanged. A third "peek" detent buys nothing on a screen with a permanent
 * CTA and doubles the gesture tuning.
 */
const COLLAPSED_RATIO = 0.42;
const EXPANDED_RATIO = 0.72;

/** Clearance between the recenter FAB and the sheet's top edge. */
const FAB_GAP = 16;

export function BookTowScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { height: screenHeight } = useWindowDimensions();

  const useCurrentLocation = useLocationStore((s) => s.useCurrentLocation);
  const towTypeId = useBookingStore((s) => s.towTypeId);
  const serviceSlug = useBookingStore((s) => s.serviceSlug);
  const pickupCoords = useBookingStore((s) => s.pickupCoords);
  const dropCoords = useBookingStore((s) => s.dropCoords);
  const pickupAddress = useBookingStore((s) => s.pickupAddress);
  const dropAddress = useBookingStore((s) => s.dropAddress);
  const note = useBookingStore((s) => s.note);
  const scheduledAt = useBookingStore((s) => s.scheduledAt);
  const contact = useBookingStore((s) => s.contact);

  const { data: services } = useServices();
  const service = services?.find((item) => item.slug === serviceSlug);
  // Until the catalogue lands, assume a tow needs a drop. Assuming the opposite
  // would fire an estimate that the server answers with a 422.
  const requiresDrop = service?.requiresDrop ?? true;

  /**
   * §7.6's request. `undefined` until there is something real to price, which
   * is what keeps `useFareEstimate` disabled rather than firing a request the
   * server would reject.
   *
   * The vehicle class comes from the selected duty card unless the catalogue
   * row pins one (a bike tow is always wheel-lift) — §9.1.5 step 1's "vehicle
   * determines class", with the server holding the same rule.
   */
  const estimateInput = useMemo(() => {
    if (requiresDrop && !dropCoords) return undefined;
    return {
      serviceSlug,
      vehicleClass: service?.defaultVehicleClass ?? vehicleClassFor(towTypeId),
      pickup: { lat: pickupCoords.latitude, lng: pickupCoords.longitude },
      ...(dropCoords ? { drop: { lat: dropCoords.latitude, lng: dropCoords.longitude } } : {}),
    };
  }, [requiresDrop, dropCoords, serviceSlug, service?.defaultVehicleClass, towTypeId, pickupCoords]);

  const estimate = useFareEstimate(estimateInput, requiresDrop);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  /**
   * W20 §7.3 — the >600 km refusal turned into the next step.
   *
   * Before this, a `manual_quote_required` 422 left the screen showing a fare
   * skeleton forever: the mutation had an error handler, the QUERY did not. The
   * refusal is a legitimate answer, not a failure, so it gets its own bar and
   * its own route onward — request → My Quotes → accept → Searching, the same
   * hand-off a normal booking makes.
   */
  const manualQuote =
    estimate.error instanceof ApiClientError && estimate.error.code === 'manual_quote_required'
      ? { distanceKm: readDistanceKm(estimate.error.details) }
      : null;
  const [quoteSheetOpen, setQuoteSheetOpen] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const requestQuote = useRequestQuote();

  const submitQuoteRequest = useCallback(
    (notes: string) => {
      // The quote contract REQUIRES a drop — and so does §7.3: a roadside job
      // never crosses 600 km, so this branch is never reachable without one.
      // The guard is for the type checker's benefit, not the customer's.
      if (!estimateInput?.drop) return;
      setQuoteError(null);
      requestQuote.mutate(
        {
          serviceSlug: estimateInput.serviceSlug,
          vehicleClass: estimateInput.vehicleClass,
          pickup: estimateInput.pickup,
          ...(pickupAddress ? { pickupAddress } : {}),
          drop: estimateInput.drop,
          ...(dropAddress ? { dropAddress } : {}),
          ...(notes ? { notes } : {}),
        },
        {
          onSuccess: () => {
            setQuoteSheetOpen(false);
            navigation.navigate('MyQuotes');
          },
          onError: (error) =>
            setQuoteError(
              error instanceof ApiClientError
                ? error.message
                : 'We could not file the request. Please try again.',
            ),
        },
      );
    },
    [estimateInput, pickupAddress, dropAddress, requestQuote, navigation],
  );

  // §22.1. Emitted when a fare actually lands, not when the screen mounts —
  // an `estimate_viewed` fired on an empty skeleton would inflate the funnel
  // step it exists to measure.
  useEffect(() => {
    if (estimate.data) track('estimate_viewed');
  }, [estimate.data]);

  const [noteOpen, setNoteOpen] = useState(false);
  const openNote = useCallback(() => setNoteOpen(true), []);
  const closeNote = useCallback(() => setNoteOpen(false), []);
  const setNote = useBookingStore((s) => s.setNote);

  const openBreakdown = useCallback(() => setBreakdownOpen(true), []);
  const closeBreakdown = useCallback(() => setBreakdownOpen(false), []);

  // "View All" is a later phase; Confirm is real from Phase 15.
  const notReady = useCallback(() => {}, []);

  const createBooking = useCreateBooking();
  const [confirmError, setConfirmError] = useState<string | null>(null);

  /**
   * §3.4's confirm — the real POST.
   *
   * This was `navigation.navigate('Searching')` and nothing else: the app
   * showed a radar animation for a booking that had never existed.
   *
   * `navigation.replace`, not `navigate`: the booking is created, so going
   * "back" to the confirm screen would offer to create a second one — which
   * §3.8 would refuse, leaving the customer stuck on a screen whose only button
   * always fails.
   */
  const confirmBooking = useCallback(() => {
    if (!estimateInput || !service) return;
    setConfirmError(null);

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
          // §3.8's guards are the interesting failures here, and each has its
          // own code so the customer is told which one applies rather than
          // "something went wrong".
          setConfirmError(confirmMessage(error));
        },
      },
    );
  }, [
    estimateInput,
    service,
    createBooking,
    pickupAddress,
    dropAddress,
    scheduledAt,
    note,
    contact,
    navigation,
  ]);

  const snapPoints = useMemo(
    () => [screenHeight * COLLAPSED_RATIO, screenHeight * EXPANDED_RATIO],
    [screenHeight],
  );

  // The FAB used to sit in a flex spacer whose height tracked the sheet's flow
  // height. The sheet is absolutely positioned now, so that link is gone and
  // the FAB is pinned to the sheet's live height instead — which is what makes
  // it ride up and down with the drag.
  const sheetHeight = useSharedValue(screenHeight * EXPANDED_RATIO);
  const fabStyle = useAnimatedStyle(() => ({ bottom: sheetHeight.value + FAB_GAP }));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      {/* Placeholder map + stylized route & drivers */}
      <MapPreview style={StyleSheet.absoluteFill} showRecenter={false} />
      <MapRouteOverlay />

      <SafeAreaView edges={['top']} style={{ flex: 1 }} pointerEvents="box-none">
        {/* Back + read-only route summary */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 20,
            paddingTop: 4,
          }}
        >
          <BackButton onPress={() => navigation.goBack()} />

          <LocationSummaryBar onEdit={() => navigation.goBack()} />
        </View>
      </SafeAreaView>

      <Animated.View style={[{ position: 'absolute', right: 16 }, fabStyle]}>
        <Pressable
          onPress={useCurrentLocation}
          accessibilityRole="button"
          accessibilityLabel="Use current location"
          pressScale={theme.motion.pressScale.chip}
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            ...theme.shadows.fab,
          }}
        >
          <LocateFixed size={22} color={theme.colors.textPrimary} />
        </Pressable>
      </Animated.View>

      <BottomSheet
        snapPoints={snapPoints}
        initialIndex={1}
        height={sheetHeight}
        header={
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                paddingHorizontal: 20,
                paddingTop: 12,
              }}
            >
              <Text variant="title" weight="semibold">
                Select Tow Type
              </Text>
              <Pressable
                onPress={notReady}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="View all tow types"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
              >
                <Text
                  weight="medium"
                  style={{ fontSize: 13, lineHeight: 19, color: theme.colors.brand }}
                >
                  View All
                </Text>
                <ChevronRight size={13} color={theme.colors.brand} strokeWidth={2.4} />
              </Pressable>
            </View>

            <Text
              color="secondary"
              style={{ fontSize: 12, lineHeight: 18, paddingHorizontal: 20, marginTop: 2 }}
            >
              Select the vehicle that best suits your need
            </Text>
          </>
        }
        // Inside the sheet but below the scroller, so the CTA can never be
        // dragged off-screen. BookingBottomBar already carries its own bottom
        // inset and top border, so it needs no changes.
        footer={
          manualQuote ? (
            <ManualQuoteBar
              distanceKm={manualQuote.distanceKm}
              submitting={requestQuote.isPending}
              errorMessage={quoteError}
              onRequest={() => {
                setQuoteError(null);
                setQuoteSheetOpen(true);
              }}
            />
          ) : (
            <BookingBottomBar
              farePaise={estimate.data?.breakdown.totalPaise}
              loading={estimate.isFetching}
              surgeActive={estimate.data?.surgeActive ?? false}
              onConfirm={confirmBooking}
              onBreakdownPress={openBreakdown}
              // §9.1.5's "confirming (spinner)" state. Disabled while the POST
              // is in flight as well as before a fare exists — a second tap
              // would be a second booking attempt, and although the
              // Idempotency-Key makes that harmless server-side, the button
              // should not invite it.
              confirmDisabled={!estimate.data || createBooking.isPending}
              confirming={createBooking.isPending}
              errorMessage={confirmError}
            />
          )
        }
      >
        <TowTypeCarousel />

        <View style={{ paddingHorizontal: 20, gap: 10, paddingBottom: 16 }}>
          <BookingOptionRow
            icon={StickyNote}
            label="Add Note (Optional)"
            // Shows the note rather than a permanent "Add" — the row was
            // previously inert AND unchanging, so there was no way to tell
            // whether anything had been captured.
            value={note.trim() ? 'Edit' : 'Add'}
            onPress={openNote}
          />

          <View style={{ marginTop: 3 }}>
            <TrustBanner />
          </View>
        </View>
      </BottomSheet>

      {/*
        Outside the sheet, deliberately. `BottomSheet` is a non-modal in-screen
        component; this one is a real modal that has to render ABOVE it and dim
        it, so nesting it inside would put the backdrop under the thing it is
        supposed to cover.
      */}
      <FareBreakdownSheet
        visible={breakdownOpen}
        onClose={closeBreakdown}
        estimate={estimate.data}
        loading={estimate.isFetching}
      />
      <NoteEditorSheet visible={noteOpen} note={note} onSave={setNote} onClose={closeNote} />
      <RequestQuoteSheet
        visible={quoteSheetOpen}
        submitting={requestQuote.isPending}
        onClose={() => setQuoteSheetOpen(false)}
        onSubmit={submitQuoteRequest}
      />
    </View>
  );
}

/**
 * The refusal's `details.distanceKm`, when it is there. `details` is typed
 * `unknown` on the error (it is whatever the backend sent), so this is the one
 * place the shape is asserted — and a missing number degrades to the copy that
 * does not need one rather than rendering `undefined km`.
 */
function readDistanceKm(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const value = (details as { distanceKm?: unknown }).distanceKm;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * §3.8's guards, in the customer's words.
 *
 * Branching on `error.code` rather than the message: the codes are the stable
 * contract (`common/errors.ts`), and a customer told "you already have a trip
 * in progress" can act on it, while "Request failed (409)" sends them to
 * support.
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
