import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text } from '@towing/ui';
import type { BookingTracking, JobStatus } from '@towing/api-contracts';

const truck = require('@/assets/illustrations/tow-light.png');

/**
 * §9.1.7's ETA chip, and §11.4's "ETA chip counts down between recomputes so it
 * never appears frozen".
 *
 * THE COUNTDOWN IS PRESENTATION, NOT ESTIMATION, and the distinction is what
 * makes it safe. The server owns the number and applies §11.5's ±40 % smoothing
 * before sending it; this ticks the DISPLAY down between those updates so a
 * customer watching for sixty seconds does not stare at an unchanging "8 min"
 * and conclude the app has frozen. It never invents a new estimate — it only
 * spends the one it was given, and it stops at "arriving now" rather than going
 * negative and claiming the driver is late.
 *
 * WHAT REPLACED `EtaStatusCard`. That one took a bare `etaMinutes: number` from
 * a frozen mock and hardcoded the copy to "Driver is on the way" — which was
 * wrong on the arrival screen, wrong during the tow and wrong after completion.
 * The copy here is derived from the §5.1 status, so it cannot describe a stage
 * the trip is not in.
 */

/** Copy per §5.1 stage. The number means something different in each. */
const COPY: Partial<Record<JobStatus, { title: string; caption: string }>> = {
  assigned: { title: 'Driver assigned', caption: 'Getting ready to set off' },
  en_route: { title: 'Driver is on the way', caption: 'Arriving in' },
  arrived: { title: 'Your driver has arrived', caption: 'Share your code to begin' },
  in_progress: { title: 'Towing your vehicle', caption: 'Reaching drop in' },
  completed: { title: 'Trip completed', caption: 'Thanks for riding with us' },
  paid: { title: 'Trip completed', caption: 'Payment received' },
};

export function LiveEtaCard({ tracking }: { tracking: BookingTracking }) {
  const theme = useTheme();
  const copy = COPY[tracking.status];

  /**
   * Seconds remaining, ticked locally from the SERVER's last value.
   *
   * Re-seeded whenever the server sends a new one — `tracking.etaSeconds` in the
   * dependency list — so a recompute always wins over the local count. Without
   * that, a client that had ticked down to 60 s would ignore a server update
   * saying 400 s and quietly under-promise for the rest of the trip.
   */
  const [remaining, setRemaining] = useState<number | null>(tracking.etaSeconds);

  useEffect(() => {
    setRemaining(tracking.etaSeconds);
  }, [tracking.etaSeconds]);

  useEffect(() => {
    if (tracking.etaSeconds === null) return;
    const timer = setInterval(() => {
      // Floors at zero. "Arriving now" is a state; a negative ETA is an
      // accusation that the driver is late, which this number cannot support.
      setRemaining((previous) => (previous === null ? null : Math.max(0, previous - 1)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [tracking.etaSeconds]);

  const showEta =
    remaining !== null &&
    (tracking.status === 'en_route' ||
      tracking.status === 'assigned' ||
      tracking.status === 'in_progress');

  const minutes = remaining === null ? null : Math.max(1, Math.round(remaining / 60));

  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        ...theme.shadows.card,
      }}
    >
      <Image source={truck} resizeMode="contain" style={{ width: 74, height: 48 }} />

      <View style={{ flex: 1 }}>
        <Text
          weight="semibold"
          style={{
            fontSize: 15,
            lineHeight: 21,
            color: tracking.status === 'arrived' ? theme.colors.brand : theme.colors.success,
          }}
        >
          {copy?.title ?? 'Your trip'}
        </Text>
        <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
          {copy?.caption ?? ''}
        </Text>

        {/*
          §19.2's labelled degradation, surfaced rather than hidden. A
          straight-line estimate is a real estimate and worth showing — but
          presenting it as a routed one is the dishonesty the `source` field
          exists to prevent.
        */}
        {showEta && tracking.etaSource === 'haversine' ? (
          <Text color="tertiary" style={{ fontSize: 11, lineHeight: 15, marginTop: 2 }}>
            Estimated — live route unavailable
          </Text>
        ) : null}
      </View>

      {showEta && minutes !== null ? (
        <View style={{ alignItems: 'center' }} accessibilityLabel={`${minutes} minutes away`}>
          <Text weight="bold" tabular style={{ fontSize: 28, lineHeight: 32 }}>
            {minutes}
          </Text>
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 17 }}>
            min
          </Text>
        </View>
      ) : null}
    </View>
  );
}
