import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTheme } from '@towing/theme';
import { Button, StatusBadge, Text } from '@towing/ui';
import { MiListSkeleton } from '@/design';
import { SubScreen } from '@/components/SubScreen';
import { TextField } from '@/components/TextField';
import { useReplySupportTicket, useSupportTicket } from '@/features/support/api/support.queries';
import { STATUS_LABEL, STATUS_TONE } from '@/features/support/lib/statusDisplay';
import { formatRelativeTime } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';

/**
 * One ticket, from the requester's side (W15, §9.4.12).
 *
 * The payload carries PUBLIC messages only — the rail has no vocabulary for an
 * internal note, which is why nothing here filters anything: the filter is the
 * backend's SQL, and a client-side filter would be a second, weaker copy of it.
 *
 * `pending_requester` is why the composer leads with a prompt: when ops have
 * asked a question, "Waiting on you" is an instruction and the box should read
 * like one.
 */
export function TicketThreadScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'TicketThread'>>();
  const ticketId = route.params.ticketId;

  const { data: ticket, isLoading, isError, refetch } = useSupportTicket(ticketId);
  const reply = useReplySupportTicket(ticketId);
  const [body, setBody] = useState('');

  const onSend = useCallback(() => {
    const text = body.trim();
    if (text.length === 0) return;
    reply.mutate(text, {
      onSuccess: () => setBody(''),
      onError: (error) => {
        // The backend's 409 carries `ticket_closed` — say what actually happened
        // rather than "something went wrong" on a form that cannot succeed.
        Alert.alert(
          'Could not send',
          error instanceof Error ? error.message : 'Please try again in a moment.',
        );
      },
    });
  }, [body, reply]);

  const finished = ticket?.status === 'resolved' || ticket?.status === 'closed';

  return (
    <SubScreen title={ticket?.subject ?? 'Ticket'} gap={14}>
      {isLoading ? (
        <MiListSkeleton rows={4} height={72} />
      ) : isError || !ticket ? (
        <View style={{ gap: 12, paddingVertical: 16 }}>
          <Text color="secondary">We could not load this ticket just now.</Text>
          <Button label="Try again" fullWidth onPress={() => void refetch()} />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <StatusBadge label={STATUS_LABEL[ticket.status]} tone={STATUS_TONE[ticket.status]} />
              <Text color="tertiary" style={{ fontSize: 12 }}>
                {ticket.reference}
              </Text>
            </View>

            {ticket.messages.map((message) => {
              const fromSupport = message.authorType === 'admin';
              return (
                <View
                  key={message.id}
                  style={{
                    alignSelf: fromSupport ? 'flex-start' : 'flex-end',
                    maxWidth: '88%',
                    backgroundColor: fromSupport ? theme.colors.card : theme.colors.brandTint,
                    borderColor: theme.colors.border,
                    borderWidth: fromSupport ? 1 : 0,
                    borderRadius: 14,
                    padding: 12,
                    gap: 4,
                  }}
                >
                  <Text color={fromSupport ? 'secondary' : 'brand'} style={{ fontSize: 11 }}>
                    {fromSupport ? (message.authorName ?? 'Support') : 'You'} ·{' '}
                    {formatRelativeTime(message.createdAt)}
                  </Text>
                  <Text style={{ fontSize: 14, lineHeight: 20 }}>{message.body}</Text>
                </View>
              );
            })}

            {ticket.messages.length === 1 && ticket.status === 'open' ? (
              <Text color="tertiary" style={{ fontSize: 13, lineHeight: 18 }}>
                Nobody has picked this up yet. Most tickets get an answer within a few hours.
              </Text>
            ) : null}
          </ScrollView>

          {finished ? (
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 18, paddingVertical: 4 }}>
              This ticket is {ticket.status === 'closed' ? 'closed' : 'resolved'}. If you still need
              help,{' '}
              <Text
                color="brand"
                style={{ fontSize: 13 }}
                onPress={() => navigation.navigate('ContactUs' as never)}
              >
                {' '}
                raise a new one
              </Text>
              .
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {ticket.status === 'pending_requester' ? (
                <Text color="brand" style={{ fontSize: 13, lineHeight: 18 }}>
                  Support asked you something — answer below to keep the ticket moving.
                </Text>
              ) : null}
              <TextField
                label="Reply"
                value={body}
                onChangeText={setBody}
                placeholder="Add an update or answer…"
                multiline
              />
              <Button
                label={reply.isPending ? 'Sending…' : 'Send'}
                fullWidth
                disabled={body.trim().length === 0 || reply.isPending}
                onPress={onSend}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SubScreen>
  );
}
