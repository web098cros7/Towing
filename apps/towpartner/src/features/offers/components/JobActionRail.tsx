import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import type { DriverJob, JobUnableReason } from '@towing/api-contracts';
import { useTheme } from '@towing/theme';
import { Button, Card, OtpInput, Text } from '@towing/ui';
import { Lock, TriangleAlert } from '@/icons';
import { ApiClientError } from '@/lib/api/errors';
import { useLastFixStore } from '@/lib/location/lastFixStore';
import { haptics, Pressable } from '@/motion';
import { driverColors } from '@/theme/driverColors';
import {
  useArriveAtJob,
  useCompleteJob,
  useStartJob,
  useUnableToDeliver,
} from '../api/offers.queries';
import { UnableSheet } from './UnableSheet';

/**
 * §5.2's chain, as the driver drives it: arrive → OTP → start → complete, with
 * unable-to-deliver as the branch out.
 *
 * ONE COMPONENT, FOUR STATES, and the alternative is what makes it worth saying:
 * a screen that renders every button and disables the ones that do not apply
 * gives a driver at a kerbside four things to read and one to tap. The rail
 * shows exactly the action §5.1 permits from the current status, so there is
 * never a decision to make about which button is the right one.
 *
 * THE STATUS COMES FROM THE SERVER, NOT FROM LOCAL PROGRESS. Every mutation
 * returns the whole `DriverJob` and the rail re-renders from it, so a job
 * completed on another device or taken away by an admin moves this screen with
 * it rather than leaving a stale Complete button that will 409.
 */

/** §11.5's arrival assist: "within 100 m of pickup + speed < 5 km/h". */
const ASSIST_RADIUS_METERS = 100;
const ASSIST_SPEED_KPH = 5;

function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function JobActionRail({ job }: { job: DriverJob }) {
  const theme = useTheme();

  const arrive = useArriveAtJob();
  const start = useStartJob();
  const complete = useCompleteJob();
  const unable = useUnableToDeliver();

  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [unableOpen, setUnableOpen] = useState(false);

  const fix = useLastFixStore((s) => s.fix);

  /**
   * §11.5's arrival assist.
   *
   * A PROMPT, NOT A GATE. The button is always tappable; this only promotes it
   * to primary and adds the "Looks like you have arrived" line. A driver whose
   * GPS is confused, or whose pickup pin is on the far side of a building, must
   * still be able to mark arrival — and the server's own 500 m backstop is what
   * actually stops an early tap from starting the waiting clock.
   *
   * `speedKph === null` counts as stopped: a stationary phone often reports no
   * speed at all, and treating "unknown" as "moving" would suppress the prompt
   * in exactly the case it is for.
   */
  const arrivalAssist = useMemo(() => {
    // Both pre-arrival states qualify: the assist is about proximity, not about
    // whether the driver happened to travel far enough to trip `en_route`.
    if (!fix) return false;
    if (job.status !== 'assigned' && job.status !== 'en_route') return false;

    const near = metresBetween(fix, job.pickup) <= ASSIST_RADIUS_METERS;
    const stopped = fix.speedKph === null || fix.speedKph < ASSIST_SPEED_KPH;
    return near && stopped;
  }, [fix, job.pickup, job.status]);

  const onArrive = useCallback(() => {
    haptics.medium();
    arrive.mutate(job.bookingId, {
      onError: (error: unknown) => {
        haptics.error();
        Alert.alert(
          'Cannot mark arrival',
          error instanceof ApiClientError && error.code === 'invalid_booking_state'
            ? 'You appear to be too far from the pickup. Move closer and try again.'
            : 'Please try again in a moment.',
        );
      },
    });
  }, [arrive, job.bookingId]);

  const onStart = useCallback(() => {
    setOtpError(null);
    haptics.medium();
    start.mutate(
      { bookingId: job.bookingId, otp },
      {
        onSuccess: () => {
          haptics.success();
          setOtp('');
        },
        onError: (error: unknown) => {
          haptics.error();
          setOtp('');
          const remaining =
            error instanceof ApiClientError
              ? (error.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining
              : undefined;
          setOtpError(
            typeof remaining === 'number' && remaining > 0
              ? `That code is not correct — ${remaining} ${remaining === 1 ? 'try' : 'tries'} left.`
              : 'That code is not correct. Ask the customer to check it in their app.',
          );
        },
      },
    );
  }, [job.bookingId, otp, start]);

  const onComplete = useCallback(() => {
    // The one confirm in the chain. Completing finalizes the fare and ends the
    // driver's claim on the job; every other step is recoverable by tapping the
    // next one, and this one is not.
    Alert.alert('Complete this job?', 'This finalizes the fare and ends the trip.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Complete',
        onPress: () => {
          haptics.medium();
          complete.mutate(job.bookingId, {
            onSuccess: () => haptics.success(),
            onError: () => {
              haptics.error();
              Alert.alert('Could not complete', 'Please try again in a moment.');
            },
          });
        },
      },
    ]);
  }, [complete, job.bookingId]);

  const onUnable = useCallback(
    (reason: JobUnableReason, note?: string) => {
      unable.mutate(
        { bookingId: job.bookingId, reason, ...(note ? { note } : {}) },
        {
          onSuccess: () => {
            setUnableOpen(false);
            haptics.warning();
          },
          onError: () => {
            haptics.error();
            Alert.alert('Could not update the job', 'Please try again in a moment.');
          },
        },
      );
    },
    [job.bookingId, unable],
  );

  return (
    <View style={{ gap: 12 }}>
      {job.status === 'assigned' || job.status === 'en_route' ? (
        <>
          {arrivalAssist ? (
            <Text
              style={{
                fontSize: 13,
                lineHeight: 18,
                color: driverColors.online,
                textAlign: 'center',
              }}
            >
              Looks like you have arrived at the pickup
            </Text>
          ) : null}
          <Button
            variant={arrivalAssist ? 'primary' : 'secondary'}
            label={arrive.isPending ? 'Marking…' : 'Mark arrived'}
            onPress={onArrive}
            disabled={arrive.isPending}
            fullWidth
            accessibilityLabel="Mark arrived"
          />
        </>
      ) : null}

      {job.status === 'arrived' ? (
        <Card
          padding={16}
          style={{ borderRadius: 20, gap: 12, backgroundColor: driverColors.noticeBg }}
        >
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Lock size={16} color={driverColors.amber} strokeWidth={2.2} />
            <Text style={{ fontSize: 14, lineHeight: 20 }}>
              Ask the customer for their 6-digit code
            </Text>
          </View>

          <OtpInput value={otp} onChange={setOtp} error={otpError !== null} autoFocus />

          {otpError ? (
            <Text
              accessibilityRole="alert"
              style={{ fontSize: 13, lineHeight: 18, color: theme.colors.error }}
            >
              {otpError}
            </Text>
          ) : null}

          <Button
            label={start.isPending ? 'Starting…' : 'Start trip'}
            onPress={onStart}
            // Six digits, or there is nothing to send. The server would refuse a
            // short code at the DTO layer anyway; disabling saves the round trip
            // and, more usefully, saves an attempt against the cap.
            disabled={otp.length !== 6 || start.isPending}
            fullWidth
            accessibilityLabel="Start trip"
          />
        </Card>
      ) : null}

      {job.status === 'in_progress' ? (
        <Button
          label={complete.isPending ? 'Completing…' : 'Complete job'}
          onPress={onComplete}
          disabled={complete.isPending}
          fullWidth
          accessibilityLabel="Complete job"
        />
      ) : null}

      {/*
        §9.2.3's unable-to-deliver, available from every pre-completion state and
        never after. It is deliberately a quiet text link rather than a button:
        it is the right action perhaps once in fifty jobs, and giving it equal
        visual weight to "Start trip" at a kerbside is how it gets tapped by
        mistake.
      */}
      {['assigned', 'en_route', 'arrived'].includes(job.status) ? (
        <Pressable
          onPress={() => setUnableOpen(true)}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel="Unable to deliver"
          style={() => ({ alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TriangleAlert size={14} color={theme.colors.textSecondary} strokeWidth={2} />
            <Text style={{ fontSize: 13, lineHeight: 18, color: theme.colors.textSecondary }}>
              Unable to deliver
            </Text>
          </View>
        </Pressable>
      ) : null}

      <UnableSheet
        visible={unableOpen}
        onDismiss={() => setUnableOpen(false)}
        onConfirm={onUnable}
        isPending={unable.isPending}
      />
    </View>
  );
}
