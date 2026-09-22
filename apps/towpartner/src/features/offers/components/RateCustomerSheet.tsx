import React, { useEffect, useState } from 'react';
import { Alert, Modal, TextInput, View } from 'react-native';
import type { RatingDto } from '@towing/api-contracts';
import { useTheme } from '@towing/theme';
import { Button, RatingInput, Text } from '@towing/ui';
import { Star } from '@/icons';
import { Pressable } from '@/motion';
import { useRateCustomer } from '../api/offers.queries';

/**
 * The driver's rating of the customer.
 *
 * OPT-IN, NEVER AUTOMATIC. The customer app opens its rating sheet by itself on
 * the payment-success screen — one tap, on a screen the customer is already
 * looking at. The driver's equivalent card is read at a kerbside with the next
 * job waiting, so nothing may slide over it uninvited: the rail renders a
 * visible button and the driver taps it if they want to.
 *
 * THE RATING IS AN OPS SIGNAL, NOT A PUBLIC SCORE. `recomputeDriverRating` on
 * the server rolls up only the customer→driver direction, so what the driver
 * writes here never reaches the customer's profile — it goes to MiTow's ops
 * team. The sub-line says so in as many words, because a driver who believes
 * the rating is public rates differently from one who knows it is a private
 * note.
 *
 * THE ENDPOINT UPSERTS. Rating again amends the same row rather than creating a
 * second one, so when `existing` is set this sheet is an amend: the stars and
 * the note are seeded from what was sent, and the primary button reads "Update
 * rating".
 */
export function RateCustomerSheet({
  visible,
  onDismiss,
  bookingId,
  customerName,
  existing,
}: {
  visible: boolean;
  onDismiss: () => void;
  bookingId: string;
  customerName: string | null;
  /** The driver's previous rating of this customer, when amending. */
  existing: RatingDto | null;
}) {
  const theme = useTheme();
  const rate = useRateCustomer();

  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [review, setReview] = useState(existing?.review ?? '');

  // Re-seed on open so reopening an amended rating shows what was sent rather
  // than whatever the driver typed and abandoned last time.
  useEffect(() => {
    if (visible) {
      setRating(existing?.rating ?? 0);
      setReview(existing?.review ?? '');
    }
  }, [visible, existing]);

  const onSubmit = () => {
    const trimmed = review.trim();
    rate.mutate(
      { bookingId, body: { rating, ...(trimmed ? { review: trimmed } : {}) } },
      {
        onSuccess: () => {
          // Close immediately on success — the rail's button flips to the rated
          // state from the cache write in `useRateCustomer`, so there is nothing
          // left to wait for.
          onDismiss();
        },
        onError: () => {
          // KEEP THE SHEET OPEN ON ERROR. This differs from the customer app,
          // which closes without waiting: the customer's sheet is one tap on a
          // success screen, while the driver may have typed a note — closing on
          // failure would throw their words away.
          Alert.alert('Could not send your rating', 'Try again in a moment.');
        },
      },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <View
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 24,
            paddingBottom: 32,
            paddingHorizontal: 24,
            gap: 12,
          }}
        >
          <Text weight="semibold" style={{ fontSize: 18, lineHeight: 24 }}>
            How was {customerName ?? 'the customer'}?
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary }}>
            Only MiTow sees this. It never reaches the customer.
          </Text>

          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            {/*
              `RatingInput` labels each star itself ("4 stars"), which is the
              handle a Maestro flow matches on — so no label is set here.
            */}
            <RatingInput value={rating} onChange={setRating} icon={Star} />
          </View>

          <TextInput
            value={review}
            onChangeText={setReview}
            multiline
            maxLength={1000}
            placeholder="Add a note for MiTow (optional)"
            placeholderTextColor={theme.colors.textSecondary}
            style={{
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 12,
              padding: 12,
              minHeight: 72,
              textAlignVertical: 'top',
              fontSize: 14,
              lineHeight: 20,
              color: theme.colors.textPrimary,
            }}
          />

          <View style={{ gap: 12, paddingTop: 4 }}>
            <Button
              label={existing ? 'Update rating' : 'Submit rating'}
              onPress={onSubmit}
              disabled={rating < 1 || rate.isPending}
              fullWidth
              accessibilityLabel={existing ? 'Update rating' : 'Submit rating'}
            />
            <Pressable
              onPress={onDismiss}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel="Not now"
              style={() => ({ alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 })}
            >
              <Text style={{ fontSize: 14, lineHeight: 20, color: theme.colors.textSecondary }}>
                Not now
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
