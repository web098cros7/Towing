import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Button, Screen, Text, OfflineBanner, EmptyState, ErrorState } from '@towing/ui';
import { ClipboardList } from '@/icons';
import { AppHeader } from '@/components/AppHeader';
import { useCollapsingHeader } from '@/motion';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTabBarSpace } from '@/navigation/TabBar';
import { useBookings } from '@/features/bookings/api/bookings.queries';
import { isActiveBooking } from '@/features/bookings/types';
import { ActiveTripCard } from '@/features/bookings/components/ActiveTripCard';
import { BookingCard, BookingCardSkeleton } from '@/features/bookings/components/BookingCard';
import type { RootStackParamList } from '@/navigation/types';

export function BookingsScreen() {
  const theme = useTheme();
  const tabBarSpace = useTabBarSpace();
  const { scrollY, screenProps } = useCollapsingHeader();
  const online = useOnlineStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useBookings();
  const active = items.find(isActiveBooking) ?? null;
  const past = items.filter((booking) => !isActiveBooking(booking));

  const openBooking = useCallback(
    (bookingId: string) => navigation.navigate('BookingDetails', { bookingId }),
    [navigation],
  );

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <View style={{ gap: theme.spacing.xxl }}>
        <BookingCardSkeleton />
        <BookingCardSkeleton />
        <BookingCardSkeleton />
      </View>
    );
  } else if (isError) {
    content = (
      <View style={{ paddingTop: theme.spacing.xl }}>
        <ErrorState
          title="Couldn't load your bookings"
          body="Check your connection and try again."
          onRetry={() => refetch()}
        />
      </View>
    );
  } else if (items.length === 0) {
    content = (
      <View style={{ paddingTop: theme.spacing.xl }}>
        <EmptyState
          icon={ClipboardList}
          title="No bookings yet"
          body="Your trips will show up here — help is one tap away."
        />
      </View>
    );
  } else {
    // 24 clears the status badge (10px overhang) and keeps the gap between cards
    // larger than the 16 inside them -- equal or tighter reads as one mushy block.
    content = (
      <View style={{ gap: theme.spacing.xxl }}>
        {/*
          §9.1.10's ACTIVE TRIP CARD, above the history and visually separated.
          Until Phase 15 an in-flight trip was unrecoverable the moment you left
          the tracking screen — nothing in the app knew it existed.
        */}
        {active ? (
          <ActiveTripCard booking={active} onPress={() => openBooking(active.id)} />
        ) : null}

        {past.map((booking) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            onPress={() => openBooking(booking.id)}
          />
        ))}

        {hasNextPage ? (
          <Button
            label={isFetchingNextPage ? 'Loading…' : 'Load more'}
            variant="secondary"
            onPress={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            fullWidth
          />
        ) : null}
      </View>
    );
  }

  return (
    <Screen
      scroll
      edges={['top']}
      banner={<OfflineBanner visible={!online} />}
      header={<AppHeader scrollY={scrollY} title="My Bookings" />}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
      {...screenProps}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
        <Text variant="h1" weight="semibold">
          My Bookings
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: 2 }}>
          Your past booking history
        </Text>
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        {content}
      </View>
    </Screen>
  );
}
