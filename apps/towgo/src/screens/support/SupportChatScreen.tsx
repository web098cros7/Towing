import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
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
import { useBooking } from '@/features/bookings/api/bookings.queries';
import { serviceTitle } from '@/features/services/data/serviceTitles';
import { useSupportContact } from '@/features/app-config/appConfig';
import {
  useCreateSupportTicket,
  useReplySupportTicket,
  useSupportTicket,
} from '@/features/support/api/support.queries';
import { storage } from '@/lib/storage/storage';
import type { RootStackParamList } from '@/navigation/types';
import { dial } from '@/screens/emergency/emergency.data';
import { ChatComposer } from '@/screens/booking/chat/ChatComposer';
import { useKeyboardOpen } from '@/screens/booking/chat/useKeyboardOpen';

/**
 * Figma 60 · Support Chat (`297:3403`), route `SupportChat { bookingId? }`.
 *
 * The conversation IS one support ticket on the W15 rail. The ticket id is kept
 * in MMKV under `support.chatTicketId`; the ticket is polled every 5 s while the
 * screen is focused, so replies from the support console arrive without a
 * refresh. A `resolved`/`closed` ticket (or a 404) is forgotten so the next
 * message starts a fresh one.
 *
 * Layout: Header `297:3576` (64 tall), optional Topic `297:3594` (12 below the
 * header, 21 side margins), Messages `297:3599` (scroll, 21 side margins, gap 8),
 * Quick replies `297:3630` (horizontal scroll, hidden while the keyboard is up) and
 * the Composer `297:3624`. The KeyboardAvoidingView is the screen's root so its frame
 * starts at the window top and needs no offset for the safe area.
 */
const CHAT_TICKET_KEY = 'support.chatTicketId';

export function SupportChatScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bookingId } = useRoute<RouteProp<RootStackParamList, 'SupportChat'>>().params ?? {};

  const { data: booking } = useBooking(bookingId ?? '');
  const { phoneDial } = useSupportContact();
  const keyboardOpen = useKeyboardOpen();

  const [ticketId, setTicketId] = useState<string | null>(() => {
    const stored = storage.getString(CHAT_TICKET_KEY);
    return stored && stored.length > 0 ? stored : null;
  });
  const [draft, setDraft] = useState('');

  const ticketQuery = useSupportTicket(ticketId, 5000);
  const createTicket = useCreateSupportTicket();
  const replyTicket = useReplySupportTicket(ticketId ?? '');

  // Forget a ticket that has been resolved/closed, or that no longer exists.
  useEffect(() => {
    if (!ticketId) return;
    if (ticketQuery.isError) {
      storage.delete(CHAT_TICKET_KEY);
      setTicketId(null);
      return;
    }
    const status = ticketQuery.data?.status;
    if (status === 'resolved' || status === 'closed') {
      storage.delete(CHAT_TICKET_KEY);
      setTicketId(null);
    }
  }, [ticketId, ticketQuery.isError, ticketQuery.data?.status]);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const sendText = useCallback(
    async (text: string) => {
      if (ticketId) {
        await replyTicket.mutateAsync(text);
        return;
      }
      const body = text.length < 4 ? `Chat started: ${text}` : text;
      const subject = booking ? `Chat with MiTow Support \u00b7 ${booking.reference}` : 'Chat with MiTow Support';
      const created = await createTicket.mutateAsync({
        category: 'other',
        subject,
        body,
        bookingId: booking?.id,
      });
      storage.set(CHAT_TICKET_KEY, created.ticketId);
      setTicketId(created.ticketId);
    },
    [ticketId, replyTicket, createTicket, booking],
  );

  const onComposerSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setDraft('');
      try {
        await sendText(trimmed);
      } catch {
        setDraft(text);
        Alert.alert('Message not sent', 'Please try again.');
      }
    },
    [sendText],
  );

  const onShareTrip = useCallback(async () => {
    if (!booking) return;
    const text = `Booking ${booking.reference} · ${booking.originLabel} → ${booking.destinationLabel}`;
    try {
      await sendText(text);
    } catch {
      Alert.alert('Message not sent', 'Please try again.');
    }
  }, [booking, sendText]);

  const scrollRef = useRef<ScrollView>(null);
  const positioned = useRef(false);

  const onContentSizeChange = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: positioned.current });
    positioned.current = true;
  }, []);

  const hasTopic = Boolean(bookingId && booking);

  const messages: ChatMessage[] = (ticketQuery.data?.messages ?? []).map((m) => ({
    id: m.id,
    side: m.authorType === 'requester' ? 'outgoing' : 'incoming',
    text: m.body,
    time: formatTime(new Date(m.createdAt)),
  }));

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}
    >
      <MiScreen edges={['top']}>
        <StatusBar style="dark" />

        <SupportHeader onBack={goBack} phoneDial={phoneDial} />

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
              {`About booking ${booking.reference} · ${serviceTitle(booking.serviceSlug) ?? 'Tow'}`}
            </MiText>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingTop: hasTopic ? 2 : 12,
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
        </ScrollView>

        {!keyboardOpen ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 21, gap: 8, paddingBottom: 10 }}
          >
            <MiChip label="Talk to an agent" onPress={() => dial(phoneDial)} />
            <MiChip label="Share trip details" onPress={() => void onShareTrip()} />
            <MiChip label="End chat" onPress={goBack} />
          </ScrollView>
        ) : null}

        <ChatComposer value={draft} onChangeText={setDraft} onSend={(t) => void onComposerSend(t)} />
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
        <MiText variant="strong16">MiTow Support</MiText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: mitowColors.successText,
            }}
          />
          <MiText variant="bodyS14" color="secondary">
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
