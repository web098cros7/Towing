import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { ErrorState, Screen, Skeleton, Text } from '@towing/ui';
import type { SupportTicketMessage } from '@towing/api-contracts';
import { Send } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { Pressable } from '@/motion';
import { driverColors } from '@/theme/driverColors';
import { useReplyToTicket, useSupportTicket } from '@/features/support/api/support.queries';
import { SUPPORT_STATUS_LABEL } from '@/features/support/statusLabel';
import type { RootStackParamList } from '@/navigation/types';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';
const ADMIN_BUBBLE_BG = '#F3F4F6';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function SupportTicketScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'SupportTicket'>>();
  const { ticketId } = route.params;

  const { data: ticket, isLoading, isError, refetch } = useSupportTicket(ticketId);
  const reply = useReplyToTicket(ticketId);

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [ticket?.messages.length]);

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (!body || reply.isPending) return;
    setDraft('');
    reply.mutate(body, {
      onError: () => {
        setDraft(body);
        Alert.alert('Message not sent', 'Please try again in a moment.');
      },
    });
  }, [draft, reply]);

  const canSend = draft.trim().length > 0 && !reply.isPending;
  const closed = ticket?.status === 'closed';

  return (
    <Screen edges={['top']} contentContainerStyle={{ flex: 1 }}>
      <DriverHeader
        leading="back"
        title={ticket?.subject ?? 'Request'}
        subtitle={
          ticket ? `${ticket.reference} · ${SUPPORT_STATUS_LABEL[ticket.status]}` : undefined
        }
        onLeading={() => navigation.goBack()}
        showBell={false}
      />

      {isLoading ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 12 }}>
          <Skeleton height={64} radius={18} />
          <Skeleton height={64} radius={18} />
          <Skeleton height={64} radius={18} />
        </View>
      ) : isError || !ticket ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorState title="Could not load request" onRetry={() => refetch()} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 16,
              gap: 10,
            }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {ticket.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ScrollView>

          {closed ? (
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: Platform.OS === 'ios' ? 24 : 14,
                borderTopWidth: 1,
                borderTopColor: HAIRLINE,
                backgroundColor: theme.colors.surface0,
              }}
            >
              <Text color="secondary" style={{ fontSize: 13, lineHeight: 18, textAlign: 'center' }}>
                This request is closed. Start a new one if you still need help.
              </Text>
            </View>
          ) : (
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
                maxLength={4000}
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
          )}
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

function MessageBubble({ message }: { message: SupportTicketMessage }) {
  if (message.authorType === 'system') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 4 }}>
        <Text style={{ fontSize: 12, lineHeight: 16, color: INK_SOFT, textAlign: 'center' }}>
          {message.body}
        </Text>
      </View>
    );
  }

  const mine = message.authorType === 'requester';

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {!mine ? (
        <Text
          style={{
            fontSize: 12,
            lineHeight: 16,
            color: INK_SOFT,
            marginBottom: 3,
            marginHorizontal: 4,
          }}
        >
          {message.authorName ?? 'MiTow Support'}
        </Text>
      ) : null}
      <View
        style={{
          maxWidth: '82%',
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 18,
          borderTopRightRadius: mine ? 6 : 18,
          borderTopLeftRadius: mine ? 18 : 6,
          backgroundColor: mine ? driverColors.online : ADMIN_BUBBLE_BG,
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
      {message.attachments.length > 0 ? (
        <Text
          style={{
            fontSize: 12,
            lineHeight: 16,
            color: INK_SOFT,
            marginTop: 3,
            marginHorizontal: 4,
          }}
        >
          📎 {message.attachments.length} attachment{message.attachments.length === 1 ? '' : 's'}
        </Text>
      ) : null}
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
