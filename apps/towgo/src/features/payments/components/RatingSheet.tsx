import React, { useEffect, useState } from 'react';
import { Modal, TextInput, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Button, RatingInput, Text } from '@towing/ui';
import { Star } from '@/icons';
import { useRatingState, useSubmitRating } from '../api/payments.queries';

/**
 * §9.1.9's "prompts rating" and §9.1.10's "rate & review".
 *
 * NOT BLOCKING, and that is the design. A customer whose tow just finished owes
 * the platform nothing, and a modal they cannot dismiss is how you train people
 * to tap one star to make it go away. "Not now" is a first-class option and the
 * prompt does not return for the same trip in the same session.
 *
 * WHAT IT FEEDS is not cosmetic: §6.2 gives `drivers.rating` 15 % of every
 * dispatch score, and until Phase 19 nothing wrote that column at all — the
 * matcher ran on whatever the seed happened to set. These taps are the first
 * real input it has ever had.
 */
export function RatingSheet({
  bookingId,
  driverName,
  visible,
  onDismiss,
}: {
  bookingId: string;
  driverName: string | null;
  visible: boolean;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');

  const { data: state } = useRatingState(bookingId, visible);
  const submit = useSubmitRating();

  useEffect(() => {
    if (!visible) return;
    // Seed from an existing rating so reopening shows what they said rather
    // than an empty row — the endpoint upserts, so amending is supported.
    setRating(state?.mine?.rating ?? 0);
    setReview(state?.mine?.review ?? '');
  }, [visible, state?.mine?.rating, state?.mine?.review]);

  const send = (): void => {
    if (rating < 1) return;
    submit.mutate(
      { bookingId, body: { rating, ...(review.trim() ? { review: review.trim() } : {}) } },
      { onSuccess: onDismiss },
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
            padding: 24,
            paddingBottom: 36,
            gap: 16,
            alignItems: 'center',
          }}
        >
          <Text weight="semibold" style={{ fontSize: 18, lineHeight: 24, textAlign: 'center' }}>
            How was your tow{driverName ? ` with ${driverName}` : ''}?
          </Text>

          <RatingInput value={rating} onChange={setRating} icon={Star} filledIcon={Star} />

          <TextInput
            value={review}
            onChangeText={setReview}
            placeholder="Anything you'd like to add? (optional)"
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            accessibilityLabel="Review"
            style={{
              alignSelf: 'stretch',
              minHeight: 72,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: theme.colors.textPrimary,
              textAlignVertical: 'top',
            }}
          />

          <View style={{ alignSelf: 'stretch', gap: 10 }}>
            <Button
              label={submit.isPending ? 'Sending…' : 'Submit rating'}
              onPress={send}
              // A rating is required; the words are not. §9.1.10 asks for "rate
              // & review", and requiring text would cost most of the ratings —
              // which are the input §6.2 actually needs.
              disabled={rating < 1 || submit.isPending}
              accessibilityLabel="Submit rating"
              fullWidth
            />
            <Button
              variant="ghost"
              label="Not now"
              onPress={onDismiss}
              accessibilityLabel="Skip rating"
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
