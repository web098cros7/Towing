import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { SOS_UNDO_WINDOW_SECONDS } from '@towing/api-contracts';
import { Text } from '@towing/ui';
import { TriangleAlert } from '@/icons';
import { haptics, Pressable } from '@/motion';
import { useLastFixStore } from '@/lib/location/lastFixStore';
import * as locationService from '@/lib/location/driverLocationService';
import { sendSos, cancelSos } from '../sos';

const SOS_RED = '#DC2626';

/**
 * The driver's SOS (Phase 19).
 *
 * A DRIVER HAS NO OTHER WAY TO CALL FOR HELP FROM THIS APP. The customer app
 * has had one since Phase 12; the driver app has had a phone number and a
 * prayer. This is the button that closes that gap, and it is deliberately the
 * loudest thing on the screen — outlined in red, full width, at the bottom of
 * the active job, where a driver's thumb already is.
 *
 * IT IS NOT A 112 DIALER. Tapping it does not call anyone; it raises an alert
 * on MiTow's safety desk with the driver's location and the booking attached,
 * so the person who answers already knows which job and where. If the driver
 * is in immediate danger, the failure path offers 112 — but the primary action
 * is the one that gets a human from MiTow on the line.
 *
 * THE UNDO WINDOW IS FIVE SECONDS. Long enough to catch a fat-finger, short
 * enough that a real emergency is not delayed. After the window the sent state
 * stays for the life of this screen — the alert is out, and pretending it can
 * be recalled would be a lie.
 */
export function SosButton({ bookingId }: { bookingId: string }) {
  const fix = useLastFixStore((s) => s.fix);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startUndoCountdown = useCallback(() => {
    setSecondsLeft(SOS_UNDO_WINDOW_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  const send = useCallback(async () => {
    setSending(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      let accuracyM: number | undefined;

      if (fix) {
        lat = fix.lat;
        lng = fix.lng;
        if (fix.accuracyM !== null) accuracyM = fix.accuracyM;
      } else {
        const current = await locationService.currentFix();
        if (current) {
          lat = current.coords.latitude;
          lng = current.coords.longitude;
          if (typeof current.coords.accuracy === 'number') {
            accuracyM = current.coords.accuracy;
          }
        }
      }

      if (lat === undefined || lng === undefined) {
        setSending(false);
        Alert.alert('No location', 'Turn on location and try again.');
        return;
      }

      const result = await sendSos({
        lat,
        lng,
        ...(accuracyM !== undefined ? { accuracyM } : {}),
        bookingId,
      });

      haptics.warning();
      setAlertId(result.alertId);
      startUndoCountdown();
    } catch {
      haptics.error();
      Alert.alert('Could not send SOS', 'Call 112 if you are in danger.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call 112',
          style: 'destructive',
          onPress: () => {
            void Linking.openURL('tel:112').catch(() => {});
          },
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [bookingId, fix, startUndoCountdown]);

  const onPress = useCallback(() => {
    Alert.alert(
      'Send an SOS?',
      "MiTow's safety team will be alerted with your location and this job.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: () => void send() },
      ],
    );
  }, [send]);

  const onUndo = useCallback(async () => {
    if (!alertId) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      await cancelSos(alertId);
      setAlertId(null);
      setSecondsLeft(0);
      Alert.alert('SOS cancelled');
    } catch {
      haptics.error();
      Alert.alert('Could not cancel', 'The alert is still active.');
    }
  }, [alertId]);

  if (alertId) {
    return (
      <View
        style={{
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: SOS_RED,
          backgroundColor: '#FEF2F2',
          paddingVertical: 12,
          paddingHorizontal: 16,
          gap: 6,
        }}
      >
        <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, color: SOS_RED }}>
          SOS sent — help is being arranged
        </Text>
        {secondsLeft > 0 ? (
          <Pressable
            onPress={() => void onUndo()}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={`Undo SOS, ${secondsLeft} seconds remaining`}
            style={() => ({ alignSelf: 'flex-start', paddingVertical: 4 })}
          >
            <Text style={{ fontSize: 14, lineHeight: 20, color: SOS_RED, textDecorationLine: 'underline' }}>
              Undo ({secondsLeft})
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={sending}
      haptic="medium"
      accessibilityRole="button"
      accessibilityLabel="SOS — I need help"
      style={() => ({
        height: 48,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: SOS_RED,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        opacity: sending ? 0.6 : 1,
      })}
    >
      <TriangleAlert size={18} color={SOS_RED} strokeWidth={2.4} />
      <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, color: SOS_RED }}>
        SOS — I need help
      </Text>
    </Pressable>
  );
}
