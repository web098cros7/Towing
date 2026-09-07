import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Share, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Button, StatusBadge, Text } from '@towing/ui';
import { BackButton } from '@/components/BackButton';
import { DriverInfoCard } from '@/features/booking/components/DriverInfoCard';
import { TrustBanner } from '@/features/booking/components/TrustBanner';
import { useBooking, useCancelBooking } from '@/features/bookings/api/bookings.queries';
import { STATUS_META } from '@/features/bookings/statusMeta';
import { trackingDataSource } from '@/features/tracking/api/trackingDataSource';
import { useRevokeShare, useShareTrip } from '@/features/tracking/api/tracking.queries';
import { BookingOtpCard } from '@/features/tracking/components/BookingOtpCard';
import { CancelTripSheet } from '@/features/tracking/components/CancelTripSheet';
import { PaymentSheet } from '@/features/payments/components/PaymentSheet';
import { RatingSheet } from '@/features/payments/components/RatingSheet';
import { ConnectionBanner } from '@/features/tracking/components/ConnectionBanner';
import { LiveEtaCard } from '@/features/tracking/components/LiveEtaCard';
import { StatusTimeline, hasTimelinePosition } from '@/features/tracking/components/StatusTimeline';
import { TrackingMap } from '@/features/tracking/components/TrackingMap';
import { useLiveTracking } from '@/features/tracking/hooks/useLiveTracking';
import { Share2 } from '@/icons';
import { track } from '@/lib/analytics/analytics';
import { BottomSheet, Pressable } from '@/motion';
import type { RootStackParamList } from '@/navigation/types';

/**
 * §9.1.7's live tracking — rebuilt in Phase 18.
 *
 * WHAT THIS SCREEN USED TO BE, because it is the clearest statement of what the
 * phase was for. It rendered a real status pill on top of `assignedDriverMock` —
 * `Ramesh Kumar`, `KA 03 AB 1234`, rating 4.8, ETA 12 minutes — the same person
 * for every trip regardless of who actually matched, over a map whose route was
 * a hardcoded SVG path and whose driver marker was positioned at `left: '84%'`.
 * Its Cancel button called `navigation.popToTop()`: it cancelled nothing, the
 * booking stayed live, and a driver kept coming.
 *
 * Every one of those is gone. What replaces them:
 *   · a real driver, from `GET /bookings/:id/tracking`
 *   · a real position, interpolated and bearing-rotated (§11.4)
 *   · the collection OTP, from the hook that has existed unused since Phase 15
 *   · §11.6's honesty states, driven by real ping age
 *   · §11.7's share link
 *   · a cancel that quotes §3.5's fee and then actually cancels
 *
 * THE SHEET IS THE UNIT OF LAYOUT and the map is the backdrop, unchanged from
 * Phase 12's arrangement — that part was right. What changed is that dragging
 * the sheet down now reveals something worth looking at.
 */

const PEEK_RATIO = 0.28;
const DEFAULT_RATIO = 0.55;
const FULL_RATIO = 0.85;

export function TrackingScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { height: screenHeight } = useWindowDimensions();

  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'Tracking'>>().params;

  const { data: booking } = useBooking(bookingId, { poll: true });
  /**
   * ⚠ THE POLL STOPS ON A TERMINAL STATUS, which it did not before Phase 19.
   *
   * `useTracking`'s `enabled` defaults to true and this screen never passed it,
   * so a finished trip kept polling `GET /bookings/:id/tracking` every ten
   * seconds — forever, for as long as the screen stayed mounted. (`useBooking`
   * already halted itself via `isActiveBooking`; the tracking hook is the one
   * that did not.)
   */
  const { tracking, presence } = useLiveTracking(bookingId, !isSettled(booking?.status));

  const shareTrip = useShareTrip(bookingId);
  const revokeShare = useRevokeShare(bookingId);
  const cancelBooking = useCancelBooking();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);

  const goHome = useCallback(() => navigation.popToTop(), [navigation]);

  const snapPoints = useMemo(
    () => [screenHeight * PEEK_RATIO, screenHeight * DEFAULT_RATIO, screenHeight * FULL_RATIO],
    [screenHeight],
  );

  const status = tracking?.status ?? booking?.status;

  /**
   * ⚠ WHAT HAPPENED HERE BEFORE PHASE 19: NOTHING.
   *
   * The screen had no reaction to a terminal status at all. When a trip
   * completed the badge flipped to "Completed", the cancel button disappeared,
   * the ten-second poll carried on, and the customer sat on a live map of a
   * finished trip with a back arrow. There was no way to pay, no invoice, and
   * no rating prompt — the whole post-trip moment simply did not exist.
   *
   * A ONE-SHOT `useRef` GUARD, copying `SearchingScreen`'s `advanced.current`:
   * without it, a customer who dismisses the payment sheet gets it thrown back
   * at them on the very next poll, which is a trap rather than a prompt.
   */
  const settledOnce = useRef(false);

  useEffect(() => {
    if (!status || settledOnce.current) return;

    if (status === 'completed') {
      settledOnce.current = true;
      setPayOpen(true);
      return;
    }

    if (status === 'paid') {
      // Already paid — reached by the §19.3 sweep or the webhook settling
      // before the app got there. Straight to the rating.
      settledOnce.current = true;
      setRateOpen(true);
      return;
    }

    if (status === 'cancelled') {
      settledOnce.current = true;
      goHome();
    }
  }, [goHome, status]);

  /**
   * §11.7's share sheet.
   *
   * RN CORE `Share`, not `expo-sharing`. The OTA policy has exactly three native
   * rebuild points — Phases 12, 13 and 16 — and this phase adds no new native
   * module by design. `Share.share` is part of React Native itself, so it costs
   * nothing against that boundary.
   */
  const onShare = useCallback(async () => {
    try {
      const link = await shareTrip.mutateAsync();
      await Share.share({
        message: `Follow my tow live: ${link.url}`,
        url: link.url,
      });
      // §22.1. Emitted after the sheet returns, so it counts links that were
      // actually sent rather than buttons that were tapped.
      track('trip_shared');
    } catch {
      // A dismissed share sheet rejects on iOS and is not an error. A failed
      // mint is, and the mutation's own error state carries it.
    }
  }, [shareTrip]);

  const onStopSharing = useCallback(() => {
    revokeShare.mutate();
  }, [revokeShare]);

  /**
   * §9.1.7's call button.
   *
   * THE PRIVACY WARNING IS NOT OPTIONAL WHEN `masked` IS FALSE. No masked-calling
   * provider is provisioned (SETUP-CHECKLIST item 13), so the live path returns
   * the driver's real number — and dialling it without saying so would disclose
   * their personal mobile to a customer who had no way to know. The flag on the
   * response exists precisely so this branch cannot be forgotten.
   */
  const onCall = useCallback(async () => {
    let contact;
    try {
      contact = await trackingDataSource.contact(bookingId);
    } catch {
      Alert.alert('Cannot call right now', 'Please try again in a moment.');
      return;
    }

    if (!contact.dialNumber) {
      Alert.alert('No number available', 'We do not have a contact number for your driver yet.');
      return;
    }

    const dial = () => {
      void Linking.openURL(`tel:${contact.dialNumber}`).catch(() => undefined);
    };

    if (contact.masked) {
      dial();
      return;
    }

    Alert.alert(
      'Call your driver',
      `You are about to call ${contact.displayName ?? 'your driver'} on their personal number, and they will see yours. Private numbers are coming soon.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call', onPress: dial },
      ],
    );
  }, [bookingId]);

  const onCancelConfirm = useCallback(() => {
    cancelBooking.mutate(
      { bookingId },
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
  }, [bookingId, cancelBooking, goHome]);

  /** §11.6's support shortcut. Phase 20 owns the ticket; this is the honest stop-gap. */
  const onGetHelp = useCallback(() => {
    navigation.navigate('ContactUs');
  }, [navigation]);

  const sheetInset = screenHeight * PEEK_RATIO;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <TrackingMap tracking={tracking} presence={presence} bottomInset={sheetInset} />

      <SafeAreaView edges={['top']} style={{ flex: 1 }} pointerEvents="box-none">
        <View style={{ paddingHorizontal: 20, paddingTop: 4, alignSelf: 'flex-start' }}>
          <BackButton onPress={goHome} />
        </View>
      </SafeAreaView>

      <BottomSheet snapPoints={snapPoints} initialIndex={1}>
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 16 }}>
          {status ? (
            <View style={{ flexDirection: 'row' }}>
              <StatusBadge
                label={STATUS_META[status].label}
                tone={STATUS_META[status].tone}
                icon={STATUS_META[status].icon}
                pill
              />
            </View>
          ) : null}

          {/*
            §11.6, above everything else in the sheet. If the position cannot be
            trusted, that is the first thing the customer needs to know — before
            the ETA it makes unreliable and the driver card it sits under.
          */}
          <ConnectionBanner presence={presence} onGetHelp={onGetHelp} />

          {tracking ? <LiveEtaCard tracking={tracking} /> : null}

          {tracking?.driver ? (
            <DriverInfoCard
              driver={{
                name: tracking.driver.name,
                photoUrl: tracking.driver.photoUrl,
                rating: tracking.driver.rating,
                trips: tracking.driver.totalTrips,
                vehiclePlate: tracking.driver.vehiclePlate,
              }}
              vehicleLabel={
                tracking.driver.vehicleClass === 'flatbed' ? 'Flatbed tow truck' : 'Wheel-lift tow truck'
              }
              onCall={onCall}
              // No `onMessage`: in-app chat is Phase 20, and a button that opens
              // nothing is worse than a button that is not there.
            />
          ) : null}

          <BookingOtpCard
            bookingId={bookingId}
            available={booking?.otpAvailable ?? false}
            highlighted={status === 'arrived'}
          />

          {/* §11.7. Only once there is something to watch. */}
          {tracking?.driver ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="secondary"
                  onPress={onShare}
                  disabled={shareTrip.isPending}
                  leftIcon={Share2}
                  accessibilityLabel="Share this trip"
                  label={shareTrip.isPending ? 'Creating link…' : 'Share trip'}
                  fullWidth
                />
              </View>
              {tracking.shared ? (
                <Pressable
                  onPress={onStopSharing}
                  accessibilityRole="button"
                  accessibilityLabel="Stop sharing this trip"
                  style={() => ({ justifyContent: 'center', paddingHorizontal: 12 })}
                >
                  <Text weight="medium" style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                    Stop sharing
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {status && hasTimelinePosition(status) ? (
            <View
              style={{
                backgroundColor: theme.colors.card,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: 16,
              }}
            >
              <StatusTimeline status={status} />
            </View>
          ) : null}

          {/*
            Cancel lives at the bottom and only while the trip is still cancellable
            (§5.1's terminal states have nothing to cancel). It opens the sheet
            rather than acting, because §9.1.7 requires the fee to be shown first.
          */}
          {status && !['completed', 'paid', 'cancelled'].includes(status) ? (
            <Button
              variant="ghost"
              onPress={() => setCancelOpen(true)}
              accessibilityLabel="Cancel this trip"
              label="Cancel trip"
              fullWidth
            />
          ) : null}

          <TrustBanner />
        </View>
      </BottomSheet>

      <CancelTripSheet
        bookingId={bookingId}
        visible={cancelOpen}
        onDismiss={() => setCancelOpen(false)}
        onConfirm={onCancelConfirm}
        isCancelling={cancelBooking.isPending}
      />

      {/* §9.1.9. Its AC ends "…and prompts rating", which is the handoff below. */}
      <PaymentSheet
        bookingId={bookingId}
        visible={payOpen}
        onDismiss={() => setPayOpen(false)}
        onPaid={() => {
          setPayOpen(false);
          setRateOpen(true);
        }}
      />

      <RatingSheet
        bookingId={bookingId}
        driverName={tracking?.driver?.name ?? null}
        visible={rateOpen}
        onDismiss={() => {
          setRateOpen(false);
          goHome();
        }}
      />
    </View>
  );
}

/** §5.1's terminal statuses, from this screen's point of view. */
function isSettled(status: string | undefined): boolean {
  return status === 'completed' || status === 'paid' || status === 'cancelled';
}
