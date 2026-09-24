import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MiChatBubble, MiDayPill, MiScreen, mitowColors, mitowLayout } from '@/design';
import { callDriver } from '@/features/calling/callDriver';
import { useChatMessages, useSendChatMessage } from '@/features/chat/api/chat.queries';
import { useTracking } from '@/features/tracking/api/tracking.queries';
import type { RootStackParamList } from '@/navigation/types';
import { ChatComposer } from './chat/ChatComposer';
import { ChatHeader } from './chat/ChatHeader';
import { chatRows, messageTime, type ChatRow } from './chat/chatFormat';
import { QuickReplies } from './chat/QuickReplies';
import { TripStatusStrip } from './chat/TripStatusStrip';
import { displayDriver } from './tracking/trackingDisplay';

/**
 * Figma 22 · Chat with Driver (`292:2471`), root route `ChatWithDriver { bookingId }`.
 * Opened by every driver Message button through `openDriverChat`. Live, it talks to
 * `bookings/:id/messages` and the `chat:message` socket; the driver replies from
 * TowPartner's job chat.
 *
 * Pinned top: the Header and, 12 below it, the Trip status strip. Pinned bottom, as
 * one block: the Quick replies row, a 9.6 gap and the Composer. Between them the
 * message list scrolls, TOP-aligned as drawn (a short conversation leaves the white
 * space at the bottom), so it is an ordinary list, not an inverted one. It opens at
 * the newest message without animating and animates to each new one.
 *
 * With the keyboard up the bottom block rides on it and the list shrinks (22
 * Decision 3). The KeyboardAvoidingView is the screen's root, so its frame starts at
 * the window top and needs no offset for the safe area.
 *
 * Driver data is 18's: `useTracking` is the query inside 18's `useLiveTracking` (key
 * `['tracking', 'live', bookingId]`, polled every 10 s), so both screens share one
 * cache and the socket 18 keeps open underneath still patches it. The socket is NOT
 * opened here: it is an app-wide singleton, and leaving this screen would tear down
 * the one 18 is using.
 */
export function ChatWithDriverScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'ChatWithDriver'>>().params;

  const { data: tracking } = useTracking(bookingId);
  const driver = displayDriver(tracking);

  const { data: messages } = useChatMessages(bookingId);
  const { mutateAsync: sendMessage } = useSendChatMessage(bookingId);
  const [draft, setDraft] = useState('');

  const rows = useMemo(() => chatRows(messages ?? [], new Date()), [messages]);

  /** Back `292:2632`: return to the screen that opened the chat (18, 19, 20, 23 or 24). */
  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  /**
   * Call `292:2638`: 18's call action, through the shared `callDriver` helper.
   * The number comes from `contact()` and goes to the system dialer; when it is
   * unmasked the helper warns first, because the driver's real number is about
   * to be dialled and shown. A failed lookup or a missing number does nothing
   * (22 Data gap 13).
   */
  const onCall = useCallback(() => void callDriver(bookingId), [bookingId]);

  /**
   * A failed send takes its bubble back out (`useSendChatMessage`), so the text
   * returns to the composer, unless the customer has started typing something
   * else, and a system alert says so, as Support Chat does. Figma draws no
   * failed state.
   */
  const onComposerSend = useCallback(
    async (text: string) => {
      setDraft('');
      try {
        await sendMessage(text);
      } catch {
        setDraft((current) => (current === '' ? text : current));
        Alert.alert('Message not sent', 'Please try again.');
      }
    },
    [sendMessage],
  );

  /** A quick reply is one tap to resend, so only the alert. */
  const onQuickReply = useCallback(
    async (text: string) => {
      try {
        await sendMessage(text);
      } catch {
        Alert.alert('Message not sent', 'Please try again.');
      }
    },
    [sendMessage],
  );

  // --- Scrolling ------------------------------------------------------------

  const listRef = useRef<FlatList<ChatRow>>(null);
  /** Set once the list has been placed at its newest message (no animation that first time). */
  const positioned = useRef(false);

  const onContentSizeChange = useCallback(() => {
    if (rows.length === 0) return;
    listRef.current?.scrollToEnd({ animated: positioned.current });
    positioned.current = true;
  }, [rows.length]);

  /** The keyboard opening or closing resizes the list; keep the newest message in view. */
  const onListLayout = useCallback(() => {
    if (positioned.current) listRef.current?.scrollToEnd({ animated: true });
  }, []);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}
    >
      <MiScreen edges={['top']}>
        <StatusBar style="dark" />

        <ChatHeader driver={driver} onBack={goBack} onCall={() => void onCall()} />

        {/* Trip status `292:2641`: 12 below the Header, 21 side margins. */}
        <View style={{ marginTop: 12, marginHorizontal: mitowLayout.sideMargin }}>
          <TripStatusStrip tracking={tracking} />
        </View>

        {/*
          Messages `292:2652`: 10 below the strip, 21 side margins, gap 8. The 10 at
          the bottom is inferred (nothing is drawn under a full list). Empty or still
          loading: no Day pill, no bubbles, no copy (none is designed).
        */}
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={rowKey}
          renderItem={renderRow}
          ItemSeparatorComponent={MessageGap}
          onContentSizeChange={onContentSizeChange}
          onLayout={onListLayout}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingTop: 10,
            paddingBottom: 10,
          }}
        />

        <QuickReplies onSend={(text) => void onQuickReply(text)} />

        {/* Quick replies bottom (749.4) to the Composer's top border (759). */}
        <View style={{ height: 9.6 }} />

        <ChatComposer
          value={draft}
          onChangeText={setDraft}
          onSend={(text) => void onComposerSend(text)}
        />
      </MiScreen>
    </KeyboardAvoidingView>
  );
}

function rowKey(row: ChatRow): string {
  return row.key;
}

/**
 * A Day pill (`292:2653`) or a Chat Bubble. The driver's messages are Incoming (left,
 * muted), the customer's Outgoing (right, dark); each bubble always shows its time.
 */
function renderRow({ item }: ListRenderItemInfo<ChatRow>) {
  if (item.kind === 'day') return <MiDayPill label={item.label} />;
  const { message } = item;
  return (
    <MiChatBubble
      side={message.sender === 'driver' ? 'incoming' : 'outgoing'}
      message={message.text}
      time={messageTime(message)}
    />
  );
}

/** Messages gap 8, between every row. */
function MessageGap() {
  return <View style={{ height: 8 }} />;
}
