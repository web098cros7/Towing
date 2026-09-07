import React, { useCallback, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import {
  Screen,
  Text,
  OfflineBanner,
  EmptyState,
  ErrorState,
  IconButton,
} from '@towing/ui';
import {
  Headphones,
  ClipboardList,
  Truck,
  Clock,
  Route,
  IndianRupee,
  Receipt,
  ShieldCheck,
  ArrowLeft,
  Download,
  Star,
} from '@/icons';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTabBarSpace } from '@/navigation/TabBar';
import { useBooking } from '@/features/bookings/api/bookings.queries';
import { BookingHero } from '@/features/bookings/components/BookingHero';
import { RouteRows } from '@/features/bookings/components/RouteRows';
import { DetailRow, RowDivider } from '@/components/DetailRow';
import { RatingSheet } from '@/features/payments/components/RatingSheet';
import { useInvoiceLink, useRatingState } from '@/features/payments/api/payments.queries';
import { BookingDetailSkeleton } from '@/features/bookings/components/BookingDetailSkeleton';
import { PAYMENT_LABEL } from '@/features/bookings/labels';
import { towTypes } from '@/features/booking/data/towTypes.data';
import { formatEta, formatPaise } from '@/utils/format';
import type { BookingsStackParamList, RootStackParamList } from '@/navigation/types';

/**
 * Booking details.
 *
 * Structured as one flat list rather than a stack of cards. Nesting bordered,
 * shadowed cards inside a bordered page is what made this screen read as
 * cluttered: every card boundary is a line the eye has to parse before it gets
 * to the content. Here a single 24pt heading carries the hierarchy, every row
 * shares one icon column, and hairlines do the grouping.
 */
export function BookingDetailsScreen() {
  const theme = useTheme();
  const tabBarSpace = useTabBarSpace();
  const online = useOnlineStatus();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<BookingsStackParamList, 'BookingDetails'>>();
  const { bookingId } = route.params;

  const { data, isPending, isError, refetch } = useBooking(bookingId);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);
  const openSupport = useCallback(() => navigation.navigate('ContactUs'), [navigation]);

  const [rateOpen, setRateOpen] = useState(false);
  const invoice = useInvoiceLink();
  // Only fetched once the trip is finished — an unrated-state read on a live
  // trip is a request nobody needs.
  const rating = useRatingState(bookingId, data?.status === 'paid' || data?.status === 'completed');

  /**
   * §9.1.10's invoice download.
   *
   * `Linking.openURL` ON A SIGNED URL, which is what keeps this from adding a
   * native module: `expo-file-system` and `expo-sharing` are both native, and
   * Phase 19 already spends its one rebuild point on `react-native-razorpay`.
   * The URL expires in five minutes, so it is fetched on tap rather than held.
   */
  const openInvoice = useCallback(() => {
    invoice.mutate(bookingId, {
      onSuccess: (link) => {
        void Linking.openURL(link.url).catch(() =>
          Alert.alert('Could not open the invoice', 'Please try again in a moment.'),
        );
      },
      onError: () =>
        Alert.alert(
          'Invoice not ready',
          'We are still preparing this invoice. Please try again shortly.',
        ),
    });
  }, [bookingId, invoice]);
  const notReady = useCallback(() => {}, []);

  const towName = data ? (towTypes.find((t) => t.id === data.towTypeId)?.name ?? 'Tow') : '';

  let content: React.ReactNode;
  if (isPending) {
    content = <BookingDetailSkeleton />;
  } else if (isError) {
    content = (
      <View style={{ paddingTop: theme.spacing.xl }}>
        <ErrorState
          title="Couldn't load this booking"
          body="Check your connection and try again."
          onRetry={() => refetch()}
        />
      </View>
    );
  } else if (!data) {
    content = (
      <View style={{ paddingTop: theme.spacing.xl }}>
        <EmptyState
          icon={ClipboardList}
          title="Booking not found"
          body="This booking may have been removed."
          actionLabel="Back to bookings"
          onAction={goBack}
        />
      </View>
    );
  } else {
    content = (
      <>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="h1">Booking details</Text>
          <Text variant="caption" color="secondary">
            {data.reference}
          </Text>
        </View>

        <BookingHero
          booking={data}
          towName={towName}
          onCall={notReady}
          onMessage={notReady}
        />

        <View>
          <RowDivider />
          <RouteRows booking={data} />

          <RowDivider />
          <DetailRow icon={Truck} label="Tow type" value={`${towName} tow truck`} />
          {/*
            Duration, distance and payment are unknown until the trip has run —
            a searching booking legitimately has none of them. An omitted row
            reads better than "null km", and §10.9's feedback states are about
            not pretending to know things.
          */}
          {data.durationMinutes !== null ? (
            <>
              <RowDivider />
              <DetailRow
                icon={Clock}
                label="Duration"
                value={formatEta(data.durationMinutes)}
                tabular
              />
            </>
          ) : null}
          {data.distanceKm !== null ? (
            <>
              <RowDivider />
              <DetailRow icon={Route} label="Distance" value={`${data.distanceKm} km`} tabular />
            </>
          ) : null}
          {data.paymentMethod ? (
            <>
              <RowDivider />
              <DetailRow
                icon={IndianRupee}
                label="Payment"
                value={PAYMENT_LABEL[data.paymentMethod]}
              />
            </>
          ) : null}
          <RowDivider />
          <DetailRow
            icon={Receipt}
            label={data.status === 'paid' ? 'Total paid' : 'Total'}
            value={formatPaise(data.farePaise)}
            strong
            tabular
          />
          <RowDivider />

          {/*
            §9.1.10's "invoice (PDF) download".
            Gated on `paid`, following this screen's omit-when-unknown rule —
            an invoice row on an unpaid trip is a row that 409s when tapped.
          */}
          {data.status === 'paid' ? (
            <>
              <DetailRow
                icon={Download}
                label="Download invoice"
                description={invoice.isPending ? 'Preparing…' : undefined}
                chevron
                onPress={openInvoice}
              />
              <RowDivider />
            </>
          ) : null}

          {/* §9.1.10's "rate & review", reachable for anyone who dismissed the prompt. */}
          {data.status === 'paid' || data.status === 'completed' ? (
            <>
              <DetailRow
                icon={Star}
                label={rating.data?.mine ? 'Edit your rating' : 'Rate this trip'}
                description={
                  rating.data?.mine
                    ? `You rated ${rating.data.mine.rating} out of 5`
                    : 'Your rating decides who we send next time'
                }
                chevron
                onPress={() => setRateOpen(true)}
              />
              <RowDivider />
            </>
          ) : null}
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="h2">Help &amp; support</Text>
          <View>
            <DetailRow
              icon={Headphones}
              label="Need help?"
              description="Get support for this booking"
              chevron
              onPress={openSupport}
            />
            <RowDivider />
            <DetailRow
              icon={ShieldCheck}
              label="Report an issue"
              description="Tell us what went wrong on this trip"
              chevron
              onPress={openSupport}
            />
          </View>
        </View>

        <RatingSheet
          bookingId={bookingId}
          driverName={data.driverName}
          visible={rateOpen}
          onDismiss={() => setRateOpen(false)}
        />
      </>
    );
  }

  return (
    <Screen
      scroll
      edges={['top']}
      banner={<OfflineBanner visible={!online} />}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
    >
      {/* Sections sit 28 apart — comfortably more than the 14 of padding inside a
          row, so each group reads as its own block without needing a border. */}
      <View style={{ paddingHorizontal: 20, paddingTop: theme.spacing.xs, gap: 28 }}>
        {/* Back sits on its own line, left-aligned. A centred title with a floating
            action over it read as an accident rather than a layout. */}
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon={ArrowLeft} label="Go back" onPress={goBack} variant="surface" />
        </View>

        {content}
      </View>
    </Screen>
  );
}
