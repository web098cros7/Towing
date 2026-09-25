import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  MiChatBubble,
  MiChip,
  MiColorIcon,
  MiDayPill,
  MiLineIcon,
  MiMapButton,
  MiScreen,
  MiText,
  mitowColors,
  mitowLayout,
} from '@/design';
import { usePressablePrimitive } from '@towing/ui';
import { useTheme } from '@towing/theme';
import { useProfile } from '@/features/account/api/profile.queries';
import { useBooking } from '@/features/bookings/api/bookings.queries';
import { useSupportContact } from '@/features/app-config/appConfig';
import {
  useCreateSupportTicket,
  useReplySupportTicket,
  useResolveSupportTicket,
  useSupportTicket,
} from '@/features/support/api/support.queries';
import { supportDataSource } from '@/features/support/api/supportDataSource';
import { supportKeys } from '@/features/support/api/support.keys';
import { storage } from '@/lib/storage/storage';
import type { RootStackParamList } from '@/navigation/types';
import { dial } from '@/screens/emergency/emergency.data';
import { ChatComposer } from '@/screens/booking/chat/ChatComposer';
import { useKeyboardOpen } from '@/screens/booking/chat/useKeyboardOpen';
import { shortPlace } from '@/utils/address';

/**
 * Figma 60 · Support Chat (`297:3403`), route `SupportChat { bookingId? }`.
 *
 * The conversation IS one support ticket on the W15 rail, polled every 5 s so
 * replies from the support console arrive without a refresh. Help asked from a
 * trip (its Help chip → Support → Start a Live Chat) carries the trip's id: the
 * Topic strip names it and the chat is that trip's own ticket, kept apart from
 * a general chat (MMKV `support.chatTicketId` / `support.chatTicketId.<bookingId>`).
 *
 * How it behaves (owner, 25 Sep 2026: "we need to improve how chat works"):
 * - It opens on a greeting from MiTow Support, so an empty chat is not a blank
 *   screen. The greeting is the app's, not a stored message.
 * - A sent message shows at once, marked "Sending…", and hands over to the
 *   server's copy when the ticket answers; a failed one comes back into the composer.
 * - The customer's words are sent as typed (no "Chat started:" padding).
 * - "End chat" asks, then resolves the ticket on the server so the console stops
 *   waiting on it. A chat ended by either side stays readable, says so, and the
 *   next message starts a new one.
 *
 * Layout: Header `297:3576` (64 tall), optional Topic `297:3594` (12 below the
 * header, 21 side margins), Messages `297:3599` (scroll, 21 side margins, gap 8),
 * Quick replies `297:3630` (horizontal scroll, hidden while the keyboard is up) and
 * the Composer `297:3624`. The KeyboardAvoidingView is the screen's root so its frame
 * starts at the window top and needs no offset for the safe area.
 */
const CHAT_TICKET_KEY = 'support.chatTicketId';

const ticketKeyFor = (bookingId: string | undefined) =>
  bookingId ? `${CHAT_TICKET_KEY}.${bookingId}` : CHAT_TICKET_KEY;

type PendingMessage = { id: string; text: string };

export function SupportChatScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'SupportChat'>>().params ?? {};
  const queryClient = useQueryClient();

  const { data: booking } = useBooking(bookingId ?? '');
  const { data: profile } = useProfile();
  const { phoneDial } = useSupportContact();
  const keyboardOpen = useKeyboardOpen();

  const storageKey = ticketKeyFor(bookingId);
  const [ticketId, setTicketId] = useState<string | null>(() => {
    const stored = storage.getString(storageKey);
    return stored && stored.length > 0 ? stored : null;
  });
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const ticketQuery = useSupportTicket(ticketId, 5000);
  const createTicket = useCreateSupportTicket();
  const replyTicket = useReplySupportTicket(ticketId ?? '');
  const resolveTicket = useResolveSupportTicket();

  const status = ticketQuery.data?.status;
  const ended = status === 'resolved' || status === 'closed';

  const forgetTicket = useCallback(() => {
    storage.delete(storageKey);
    setTicketId(null);
  }, [storageKey]);

  // A ticket that no longer exists is forgotten outright.
  useEffect(() => {
    if (ticketId && ticketQuery.isError) forgetTicket();
  }, [ticketId, ticketQuery.isError, forgetTicket]);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const sendText = useCallback(
    async (text: string) => {
      if (ticketId && !ended) {
        await replyTicket.mutateAsync(text);
        return;
      }
      const created = await createTicket.mutateAsync({
        category: booking ? 'booking' : 'other',
        subject: booking
          ? `Chat with MiTow Support · ${booking.reference}`
          : 'Chat with MiTow Support',
        body: text,
        bookingId: booking?.id,
      });
      // Read the new ticket before showing it, so the pending bubble hands over
      // to the server's copy without a blank frame between them.
      await queryClient.fetchQuery({
        queryKey: supportKeys.detail(created.ticketId),
        queryFn: () => supportDataSource.detail(created.ticketId),
      });
      storage.set(storageKey, created.ticketId);
      setTicketId(created.ticketId);
    },
    [ticketId, ended, replyTicket, createTicket, booking, queryClient, storageKey],
  );

  const send = useCallback(
    async (text: string, restoreDraft: boolean) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = `pending-${Date.now()}`;
      setPending((list) => [...list, { id, text: trimmed }]);
      try {
        await sendText(trimmed);
      } catch {
        if (restoreDraft) setDraft(text);
        Alert.alert('Message not sent', 'Please check your connection and try again.');
      } finally {
        setPending((list) => list.filter((message) => message.id !== id));
      }
    },
    [sendText],
  );

  const onComposerSend = useCallback(
    (text: string) => {
      setDraft('');
      void send(text, true);
    },
    [send],
  );

  const onShareTrip = useCallback(() => {
    if (!booking) return;
    const from = shortPlace(booking.originLabel);
    const to = shortPlace(booking.destinationLabel);
    const route = from && to ? ` · ${from} → ${to}` : '';
    void send(`Booking ${booking.reference}${route}`, false);
  }, [booking, send]);

  const onEndChat = useCallback(() => {
    if (!ticketId || ended) {
      goBack();
      return;
    }
    Alert.alert('End this chat?', 'You can start a new chat any time.', [
      { text: 'Keep chatting', style: 'cancel' },
      {
        text: 'End chat',
        style: 'destructive',
        onPress: () =>
          resolveTicket.mutate(ticketId, {
            onSuccess: () => {
              forgetTicket();
              goBack();
            },
            onError: () =>
              Alert.alert('Could not end the chat', 'Please check your connection and try again.'),
          }),
      },
    ]);
  }, [ticketId, ended, resolveTicket, forgetTicket, goBack]);

  const scrollRef = useRef<ScrollView>(null);
  const positioned = useRef(false);

  const onContentSizeChange = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: positioned.current });
    positioned.current = true;
  }, []);

  const hasTopic = Boolean(bookingId && booking);

  const firstName = profile?.name?.trim().split(/\s+/)[0];
  const openedAt = ticketQuery.data?.createdAt ? new Date(ticketQuery.data.createdAt) : null;
  const greeting: ChatMessage = {
    id: 'greeting',
    side: 'incoming',
    text: `Hi${firstName ? ` ${firstName}` : ''}, welcome to MiTow Support. How can we help?`,
    time: formatTime(openedAt ?? new Date()),
  };

  const messages: ChatMessage[] = [
    greeting,
    ...(ticketQuery.data?.messages ?? []).map((m): ChatMessage => ({
      id: m.id,
      side: m.authorType === 'requester' ? 'outgoing' : 'incoming',
      text: m.body,
      time: formatTime(new Date(m.createdAt)),
    })),
    ...pending.map((m): ChatMessage => ({
      id: m.id,
      side: 'outgoing',
      text: m.text,
      time: 'Sending…',
    })),
  ];

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}
    >
      <MiScreen edges={['top']}>
        <StatusBar style="dark" />

        <SupportHeader onBack={goBack} phoneDial={phoneDial} />

        {/* Topic 297:3594: the trip this chat is about. */}
        {hasTopic && booking ? (
          <View
            style={{
              marginTop: 12,
              marginHorizontal: mitowLayout.sideMargin,
              backgroundColor: mitowColors.brandYellowSoft,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 10,
              paddingLeft: 12,
              paddingRight: 14,
            }}
          >
            <MiColorIcon name="tow-truck" size={30} />
            <MiText variant="strong14" style={{ flex: 1 }}>
              {`About booking ${booking.reference}`}
            </MiText>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingTop: hasTopic ? 2 : 12,
            paddingBottom: 12,
            gap: 8,
          }}
          onContentSizeChange={onContentSizeChange}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center' }}>
            <MiDayPill label="Today" />
          </View>
          {messages.map((message) => (
            <View
              key={message.id}
              style={{
                flexDirection: 'row',
                justifyContent: message.side === 'incoming' ? 'flex-start' : 'flex-end',
              }}
            >
              <MiChatBubble side={message.side} message={message.text} time={message.time} />
            </View>
          ))}
          {ended ? (
            <MiText variant="label13" color="secondary" align="center" style={{ paddingTop: 4 }}>
              This chat has ended. Send a message to start a new one.
            </MiText>
          ) : null}
        </ScrollView>

        {!keyboardOpen ? (
          // Quick replies 297:3630: one row of chips at their own height. Without
          // flexGrow 0 a horizontal ScrollView in this column takes the free space
          // and stretches every chip to it (Android, on device 25 Sep 2026).
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{
              alignItems: 'center',
              paddingHorizontal: mitowLayout.sideMargin,
              gap: 8,
              paddingBottom: 10,
            }}
          >
            <MiChip label="Talk to an agent" onPress={() => dial(phoneDial)} />
            {/* Only a chat about a trip has trip details to share. */}
            {booking ? <MiChip label="Share trip details" onPress={onShareTrip} /> : null}
            <MiChip label="End chat" onPress={onEndChat} />
          </ScrollView>
        ) : null}

        <ChatComposer value={draft} onChangeText={setDraft} onSend={onComposerSend} />
      </MiScreen>
    </KeyboardAvoidingView>
  );
}

type ChatMessage = {
  id: string;
  side: 'incoming' | 'outgoing';
  text: string;
  time: string;
};

function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  return `${h}:${m} ${period}`;
}

/**
 * Header `297:3576`: 64 tall, 16 left / 21 right padding, gap 12, bottom border.
 * Back `297:3576` (24×24 hit area, hitSlop 12), Avatar `297:3579` (42 circle,
 * brandYellowSoft, headset 24), Agent `297:3586` (name + status row) and Call
 * support `297:3591` (MiMapButton outline, phone 26, 44).
 */
function SupportHeader({ onBack, phoneDial }: { onBack: () => void; phoneDial: string }) {
  const Pressable = usePressablePrimitive();
  const theme = useTheme();

  return (
    <View
      style={{
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 16,
        paddingRight: 21,
        backgroundColor: mitowColors.surfacePage,
        borderBottomWidth: 1,
        borderBottomColor: mitowColors.borderSubtle,
      }}
    >
      <Pressable
        onPress={onBack}
        pressScale={theme.motion.pressScale.row}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={12}
        style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
      >
        <MiLineIcon name="chevron-left" size={24} />
      </Pressable>

      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: mitowColors.brandYellowSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MiLineIcon name="headset" size={24} />
      </View>

      <View style={{ flex: 1, gap: 1 }}>
        <MiText variant="strong16" numberOfLines={1}>
          MiTow Support
        </MiText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: mitowColors.success,
            }}
          />
          {/* One line, as drawn: a larger system font truncates it rather than wrapping. */}
          <MiText variant="bodyS14" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            Online · replies in about 2 mins
          </MiText>
        </View>
      </View>

      <MiMapButton
        variant="outline"
        icon="phone"
        size={44}
        iconSize={26}
        accessibilityLabel="Call support"
        onPress={() => dial(phoneDial)}
      />
    </View>
  );
}
