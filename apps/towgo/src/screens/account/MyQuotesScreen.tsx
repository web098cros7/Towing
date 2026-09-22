import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Quote } from '@towing/api-contracts';
import { Button, StatusBadge, Text } from '@towing/ui';
import { MiListSkeleton } from '@/design';
import { SubScreen } from '@/components/SubScreen';
import { SettingsList } from '@/components/SettingsList';
import { SettingsRow } from '@/components/SettingsRow';
import { useAcceptQuote, useMyQuotes } from '@/features/quotes/api/quotes.queries';
import type { RootStackParamList } from '@/navigation/types';
import { formatPaise, formatRelativeTime } from '@/utils/format';

/**
 * My Quotes (W20, §7.3) — long-distance trips the engine will not price.
 *
 * A quote is a FIXED PRICE with a deadline, so the row shows the amount and
 * when it lapses before it shows anything else; `Accept & Book` turns it into
 * the same booking the confirm button would have made, at the number a human
 * committed to. Accepting navigates to `Searching` exactly as `BookTowScreen`
 * does — the created booking starts in `searching`, and the customer should
 * not be able to tell which path created it.
 */
export function MyQuotesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, isLoading, isError, refetch, isRefetching } = useMyQuotes();
  const accept = useAcceptQuote();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = data?.items ?? [];

  const acceptQuote = (quote: Quote) => {
    setError(null);
    setBusyId(quote.id);
    accept.mutate(quote.id, {
      onSuccess: ({ booking }) => {
        setBusyId(null);
        navigation.replace('Searching', { bookingId: booking.id });
      },
      onError: (acceptError) => {
        setBusyId(null);
        // The two refusals a customer can actually hit are "it lapsed" and
        // "you already have a trip"; the server's message says which.
        setError(acceptError instanceof Error ? acceptError.message : 'Could not accept the quote.');
      },
    });
  };

  return (
    <SubScreen title="My Quotes" gap={16}>
      {isLoading ? (
        <MiListSkeleton rows={3} height={96} />
      ) : isError ? (
        <View style={{ gap: 12, paddingVertical: 16 }}>
          <Text color="secondary">
            We could not load your quotes just now. Check your connection and try again.
          </Text>
          <Button
            label={isRefetching ? 'Retrying…' : 'Try again'}
            fullWidth
            disabled={isRefetching}
            onPress={() => void refetch()}
          />
        </View>
      ) : items.length === 0 ? (
        <View style={{ gap: 12, paddingVertical: 16 }}>
          <Text color="secondary">
            No quote requests yet. Trips over 600 km are priced by our team — booking one starts the
            request and it will appear here.
          </Text>
        </View>
      ) : (
        <>
          {error ? (
            <Text color="error" style={{ fontSize: 13, lineHeight: 19 }}>
              {error}
            </Text>
          ) : null}
          <SettingsList>
            {items.map((quote) => {
              const statusLabel =
                quote.status === 'requested'
                  ? 'Awaiting price'
                  : quote.status === 'quoted'
                    ? 'Ready'
                    : quote.status === 'accepted'
                      ? 'Booked'
                      : quote.status === 'expired'
                        ? 'Expired'
                        : 'Rejected';
              const tone =
                quote.status === 'quoted'
                  ? 'warning'
                  : quote.status === 'accepted'
                    ? 'success'
                    : 'neutral';

              return (
                <SettingsRow
                  key={quote.id}
                  title={quote.totalPaise !== null ? formatPaise(quote.totalPaise) : 'Manual quote'}
                  subtitle={[
                    `${quote.pickupAddress ?? 'Pickup'} → ${quote.dropAddress ?? 'Drop'}`,
                    quote.validUntil
                      ? `Offer expires in ${expiresIn(quote.validUntil)}`
                      : formatRelativeTime(quote.requestedAt),
                  ].join(' · ')}
                  trailing={
                    quote.status === 'quoted' ? (
                      <Button
                        label={busyId === quote.id ? 'Booking…' : 'Accept & Book'}
                        height={36}
                        disabled={busyId !== null}
                        onPress={() => acceptQuote(quote)}
                      />
                    ) : (
                      <StatusBadge label={statusLabel} tone={tone} />
                    )
                  }
                />
              );
            })}
          </SettingsList>
          {items.some((quote) => quote.status === 'quoted') ? (
            <Text color="secondary" style={{ fontSize: 12, lineHeight: 18 }}>
              Accepting books the trip at that price — the fare is locked and will not change.
            </Text>
          ) : null}
        </>
      )}
    </SubScreen>
  );
}

/**
 * `formatRelativeTime` is deliberately a PAST-tense helper (it clamps at
 * "now"), so a validity window needs its own arithmetic: the customer cares
 * how much longer the price is good for, not when it was written.
 */
function expiresIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
