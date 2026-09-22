import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Screen, Text } from '@towing/ui';
import type { BookingMessage } from '@towing/api-contracts';
import { Send } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { ApiClientError } from '@/lib/api/errors';
import { Pressable } from '@/motion';
import { driverColors } from '@/theme/driverColors';
import { useJobMessages, useSendJobMessage } from '@/features/offers/api/offers.queries';
import { useChatUnreadStore } from '@/features/offers/store/chatUnreadStore';
import type { RootStackParamList } from '@/navigation/types';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';
const CUSTOMER_BUBBLE_BG = '#F3F4F6';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Trip chat (§16.3, Phase 20).
 *
 * The transcript is read from the same cache the socket frame and the five-second
 * poll write into, so a message the driver sends appears the instant the POST
 * returns and a message the customer sends appears either on the socket frame or
 * on the next poll — whichever lands first.
 *
 * THE UNREAD MARKER IS CLEARED ON FOCUS, NOT ON MOUNT. A driver who opens the
 * chat, backgrounds the app to take a call, and comes back has not seen the
 * message that arrived while they were away — the screen was mounted the whole
 * time. `useFocusEffect` is what distinguishes "the screen exists" from "the
 * driver is looking at it", and the store's `openBookingId` is set from the
 * same signal so a frame arriving while the driver is reading does not paint a
 * badge on the job screen behind them.
 */
export function JobChatScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'JobChat'>>();
  const { bookingId } = route.params;

  const { data: messages } = useJobMessages(bookingId);
  const send = useSendJobMessage(bookingId);

  const setOpen = useChatUnreadStore((s) => s.setOpen);
  const clear = useChatUnreadStore((s) => s.clear);

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // Focus/blur, not mount/unmount: the driver is "reading" the chat only while
  // it is the focused screen, and the store's open flag has to track that.
  useFocusEffect(
    useCallback(() => {
      setOpen(bookingId);
      clear(bookingId);
      return () => {
        setOpen(null);
      };
    }, [bookingId, setOpen, clear]),
  );

  // Auto-scroll to the end whenever the transcript grows. `onContentSizeChange`
  // on the ScrollView is what actually fires this reliably across platforms;
  // this effect is the belt to that braces for the case where the list is
  // already tall enough that the content size does not change.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages?.length]);

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    send.mutate(body, {
      onError: (error: unknown) => {
        // Restore the text so the driver does not have to retype it — the
        // failure is almost always transient and the message is still wanted.
        setDraft(body);
        if (error instanceof ApiClientError && error.status === 409) {
          Alert.alert('Chat closed', 'This trip has ended.');
          return;
        }
        Alert.alert('Message not sent', 'Please try again in a moment.');
      },
    });
  }, [draft, send]);

  const canSend = draft.trim().length > 0 && !send.isPending;

  return (
    <Screen edges={['top']} contentContainerStyle={{ flex: 1 }}>
      <DriverHeader
        leading="back"
        title="Chat with customer"
        onLeading={() => navigation.goBack()}
        showBell={false}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 10 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages && messages.length > 0 ? (
            messages.map((m) => <Bubble key={m.id} message={m} />)
          ) : (
            <View style={{ paddingTop: 40, alignItems: 'center' }}>
              <Text color="secondary" style={{ fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
                Say hello — messages here are only visible to you and the customer.
              </Text>
            </View>
          )}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 10,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: Platform.OS === 'ios' ? 24 : 14,
            borderTopWidth: 1,
            borderTopColor: HAIRLINE,
            backgroundColor: theme.colors.surface0,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={1000}
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 120,
              paddingHorizontal: 14,
              paddingTop: 11,
              paddingBottom: 11,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: HAIRLINE,
              backgroundColor: theme.colors.surface1,
              color: theme.colors.textPrimary,
              fontSize: 15,
              lineHeight: 20,
            }}
          />
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
            style={() => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: canSend ? driverColors.online : '#D1D5DB',
            })}
          >
            <Send size={18} color="#FFFFFF" strokeWidth={2.2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Bubble({ message }: { message: BookingMessage }) {
  const mine = message.senderType === 'driver';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '82%',
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 18,
          borderTopRightRadius: mine ? 6 : 18,
          borderTopLeftRadius: mine ? 18 : 6,
          backgroundColor: mine ? driverColors.online : CUSTOMER_BUBBLE_BG,
        }}
      >
        <Text
          style={{
            fontSize: 15,
            lineHeight: 21,
            color: mine ? '#FFFFFF' : '#111827',
          }}
        >
          {message.body}
        </Text>
      </View>
      <Text
        style={{
          fontSize: 11,
          lineHeight: 15,
          color: INK_SOFT,
          marginTop: 3,
          marginHorizontal: 4,
        }}
      >
        {formatTime(message.createdAt)}
      </Text>
    </View>
  );
}
