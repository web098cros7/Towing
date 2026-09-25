import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import {
  MiButton,
  MiChip,
  MiColorIcon,
  MiNavBar,
  MiScreen,
  MiText,
  mitowColors,
  mitowLayout,
} from '@/design';
import { useCreateSupportTicket } from '@/features/support/api/support.queries';
import type { RootStackParamList } from '@/navigation/types';
import { StarRow } from '@/screens/payment/rating/StarRow';

/**
 * Figma 62 · Share Feedback (`525:18692`), route `ShareFeedback`, opened from
 * Support's "Share Feedback" card.
 *
 * Content `525:18693` (21 side margins, gap 16): Nav bar, Intro `525:18747`,
 * Rating `525:18763`, Topic `525:18700`, the "Tell us more" Text Area and its
 * helper line `534:20647`. "Send Feedback" `525:18720` is pinned at the bottom.
 *
 * Sending files a support ticket on the W15 rail, so the team reads it in the
 * support console ("We read every message"): the topic picks the category, the
 * subject carries the rating. A rating is required; topic and text are optional.
 */

/** The six chips drawn in `525:18702`, verbatim. */
const TOPICS = ['App experience', 'Booking', 'Drivers', 'Pricing', 'Payments', 'Other'] as const;

type Topic = (typeof TOPICS)[number];

/** The ticket category each topic files under. */
const TOPIC_CATEGORY: Record<Topic, 'booking' | 'payment' | 'app' | 'other'> = {
  'App experience': 'app',
  Booking: 'booking',
  Drivers: 'booking',
  Pricing: 'payment',
  Payments: 'payment',
  Other: 'other',
};

const MAX_TEXT = 500;

export function ShareFeedbackScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const theme = useTheme();
  const createTicket = useCreateSupportTicket();

  const [rating, setRating] = useState(0);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    if (sending || rating === 0) return;
    setSending(true);
    try {
      const trimmed = text.trim();
      const stars = `${rating}/5`;
      await createTicket.mutateAsync({
        category: topic ? TOPIC_CATEGORY[topic] : 'other',
        subject: topic ? `Feedback · ${stars} · ${topic}` : `Feedback · ${stars}`,
        body:
          trimmed.length >= 4 ? trimmed : `Rated MiTow ${stars}.${trimmed ? ` ${trimmed}` : ''}`,
      });
      Alert.alert('Thanks for your feedback', 'It helps us make MiTow better.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Could not send your feedback', 'Please check your connection and try again.');
    } finally {
      setSending(false);
    }
  }, [sending, rating, text, topic, createTicket, navigation]);

  return (
    <MiScreen
      edges={['top']}
      footer={
        // Send Feedback 525:18720: 54 tall, 43 above the frame's bottom.
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(insets.bottom, 43),
          }}
        >
          <MiButton
            tone="dark"
            label="Send Feedback"
            onPress={() => void send()}
            disabled={rating === 0 || sending}
            loading={sending}
          />
        </View>
      }
    >
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: 16,
          paddingBottom: 24,
        }}
      >
        <MiNavBar title="Share Feedback" trailing="none" onBack={() => navigation.goBack()} />

        {/* Intro 525:18747: brand/yellow-soft, 65 tall, radius 14, padding 8, gap 8. */}
        <View
          style={{
            height: 65,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 8,
            borderRadius: 14,
            backgroundColor: mitowColors.brandYellowSoft,
          }}
        >
          <MiColorIcon name="feedback" size={49} />
          <MiText variant="title20" numberOfLines={1} style={{ flex: 1 }}>
            Help us improve MiTow
          </MiText>
        </View>

        {/* Rating 525:18763: gap 12, five 37 stars. */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">How would you rate MiTow?</MiText>
          <StarRow value={rating} onChange={setRating} disabled={sending} />
        </View>

        {/* Topic 525:18700: gap 12, wrapping chips, gap 8. Tapping the chosen one clears it. */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">What&apos;s it about?</MiText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {TOPICS.map((label) => (
              <MiChip
                key={label}
                label={label}
                selected={topic === label}
                onPress={() => setTopic((current) => (current === label ? null : label))}
              />
            ))}
          </View>
        </View>

        {/* Text Area 281:1717: Medium 16 label, gap 8, 124 box, radius 14, counter bottom right. */}
        <View style={{ gap: 8 }}>
          <MiText variant="medium16">Tell us more</MiText>
          <View
            style={{
              height: 124,
              borderRadius: 14,
              borderWidth: focused ? 1.5 : 1.2,
              borderColor: focused ? mitowColors.brandYellow : mitowColors.borderSubtle,
              backgroundColor: mitowColors.surfacePage,
              paddingTop: 14,
              paddingHorizontal: 14,
              paddingBottom: 12,
              justifyContent: 'space-between',
            }}
          >
            <TextInput
              multiline
              textAlignVertical="top"
              style={{
                flex: 1,
                fontSize: 15,
                lineHeight: 20,
                letterSpacing: -0.225,
                color: mitowColors.textPrimary,
                fontFamily: theme.fonts.regular,
                padding: 0,
              }}
              maxLength={MAX_TEXT}
              value={text}
              onChangeText={setText}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="What did you like? What can we do better?"
              placeholderTextColor={mitowColors.textPlaceholder}
              accessibilityLabel="Tell us more"
            />
            <MiText variant="label13" color="placeholder" align="right">
              {`${text.length}/${MAX_TEXT}`}
            </MiText>
          </View>
          {/* Helper 534:20647: Body XS 13.5, text/secondary. */}
          <MiText variant="bodyXS135" color="secondary">
            Tell us what works and what we can do better. We read every message.
          </MiText>
        </View>
      </ScrollView>
    </MiScreen>
  );
}
