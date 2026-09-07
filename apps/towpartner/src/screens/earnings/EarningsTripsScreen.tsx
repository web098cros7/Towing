import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card, EmptyState, ErrorState, Screen, Skeleton, Text } from '@towing/ui';
import { FileText, RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { useEarningsTrips } from '@/features/earnings/api/earnings.queries';
import { formatPaise, formatRelativeTime } from '@/utils/format';
import type { EarningsTrip } from '@/features/earnings/types';

/**
 * §9.2.4's per-trip breakdown — the "View All" the Earnings tab has offered
 * since Phase 12 with no `onPress` behind it.
 *
 * §3.3's DRIVER-TRANSPARENCY CLAUSE IS THE WHOLE POINT: "every completed trip
 * shows the same breakdown in earnings history. No surprises = supply
 * retention." A net figure alone is not that; the band and the percentage have
 * to be on the row, next to the arithmetic that produced it.
 *
 * The numbers come from the LEDGER, not from a projection — which is what makes
 * "the driver's displayed earnings reconcile to the paisa against a direct
 * ledger query" an assertion rather than an aspiration.
 */
export function EarningsTripsScreen() {
  const navigation = useNavigation();
  const { data, isPending, isError, refetch } = useEarningsTrips();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 32 }}>
      <DriverHeader
        leading="back"
        title="Trip earnings"
        titleSize={22}
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, gap: 14 }}>
        {isError ? (
          <ErrorState title="Couldn't load your trips" onRetry={() => refetch()} icon={RefreshCw} />
        ) : isPending ? (
          <>
            <Skeleton width="100%" height={128} radius={16} />
            <Skeleton width="100%" height={128} radius={16} />
            <Skeleton width="100%" height={128} radius={16} />
          </>
        ) : data && data.items.length > 0 ? (
          data.items.map((trip) => <TripCard key={trip.bookingId} trip={trip} />)
        ) : (
          <EmptyState
            icon={FileText}
            title="No settled trips yet"
            body="Once a customer pays for a trip, its breakdown appears here."
          />
        )}
      </View>
    </Screen>
  );
}

/** Gross → commission (band + %) → net, in that order, so it reads as arithmetic. */
function TripCard({ trip }: { trip: EarningsTrip }) {
  const commissionLabel =
    trip.commissionBand && trip.commissionPct !== null
      ? `Commission (Band ${trip.commissionBand} · ${trip.commissionPct}%)`
      : 'Commission';

  return (
    <Card padding={16} bordered>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text weight="medium" style={{ fontSize: 15, lineHeight: 20 }}>
          {trip.jobCode}
        </Text>
        <Text color="secondary" style={{ fontSize: 12, lineHeight: 17 }}>
          {formatRelativeTime(trip.settledAt)}
        </Text>
      </View>

      <View style={{ gap: 6, marginTop: 12 }}>
        <Row label="Fare" value={formatPaise(trip.grossPaise)} />
        <Row label={commissionLabel} value={`- ${formatPaise(trip.commissionPaise)}`} />
        {/*
          Only when there IS one. An independent driver takes the whole pool, so
          a "Fleet share ₹0" line would be a number that exists to be zero.
        */}
        {trip.fleetSharePaise > 0 ? (
          <Row label="Fleet share" value={`- ${formatPaise(trip.fleetSharePaise)}`} />
        ) : null}
        <Row label="You earned" value={formatPaise(trip.netPaise)} strong />
      </View>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text
        color={strong ? undefined : 'secondary'}
        weight={strong ? 'semibold' : undefined}
        style={{ fontSize: 14, lineHeight: 20, flex: 1 }}
      >
        {label}
      </Text>
      <Text
        weight={strong ? 'semibold' : undefined}
        tabular
        style={{ fontSize: 14, lineHeight: 20 }}
      >
        {value}
      </Text>
    </View>
  );
}
