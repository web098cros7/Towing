import React, { useCallback, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';
import { Phone, Mail, MessageCircle, Clock, ClipboardList } from '@/icons';
import { SubScreen } from '@/components/SubScreen';
import { SettingsList } from '@/components/SettingsList';
import { SettingsRow } from '@/components/SettingsRow';
import { TextField } from '@/components/TextField';
import { Pressable } from '@/motion';
import { useSupportContact } from '@/features/app-config/appConfig';
import { useCreateSupportTicket } from '@/features/support/api/support.queries';
import { useBooking } from '@/features/bookings/api/bookings.queries';
import { SUPPORT_CATEGORIES } from '@/features/support/lib/categories';
import type { RootStackParamList } from '@/navigation/types';

/**
 * Contact Us (W15, §9.4.12).
 *
 * The message form files a REAL ticket: `POST /v1/support/tickets` with the
 * subject, the body and — when this screen was opened from a booking (§6.6's
 * "Get help") — that booking attached, so ops see the trip without asking.
 *
 * The tel/mailto/WhatsApp rows stay: sometimes a phone call is the right
 * answer, and the ticket rail does not pretend otherwise.
 */
export function ContactUsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ContactUs'>>();
  const bookingId = route.params?.bookingId;

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<SupportCategory>('other');
  const createTicket = useCreateSupportTicket();
  const { phoneDial, phoneDisplay, email } = useSupportContact();

  // §6.6: the ticket names the trip it is about, in the requester's own words
  // rather than as a bare uuid.
  const { data: booking } = useBooking(bookingId ?? '', { poll: false });

  const canSend = subject.trim().length >= 4 && message.trim().length >= 4;

  const callUs = useCallback(() => {
    Linking.openURL(`tel:${phoneDial}`).catch(() => {});
  }, [phoneDial]);
  const emailUs = useCallback(() => {
    Linking.openURL(`mailto:${email}`).catch(() => {});
  }, [email]);
  const whatsAppUs = useCallback(() => {
    Linking.openURL(`https://wa.me/${phoneDial.replace('+', '')}`).catch(() => {});
  }, [phoneDial]);

  const send = useCallback(() => {
    createTicket.mutate(
      {
        category,
        subject: subject.trim(),
        body: message.trim(),
        ...(bookingId ? { bookingId } : {}),
      },
      {
        onSuccess: (ticket) => {
          setSubject('');
          setMessage('');
          Alert.alert(
            'Ticket raised',
            `Your reference is ${ticket.reference}. We reply in the app.`,
            [
              { text: 'OK' },
              {
                text: 'View ticket',
                onPress: () => navigation.navigate('TicketThread', { ticketId: ticket.ticketId }),
              },
            ],
          );
        },
        onError: (error) =>
          Alert.alert(
            'Could not send',
            error instanceof Error ? error.message : 'Please try again in a moment.',
          ),
      },
    );
  }, [bookingId, category, createTicket, message, navigation, subject]);

  return (
    <SubScreen title="Contact Us" gap={18}>
      <SettingsList>
        <SettingsRow
          icon={Phone}
          iconColor={theme.colors.success}
          title="Call us"
          subtitle={phoneDisplay}
          trailing="chevron"
          onPress={callUs}
        />
        <SettingsRow
          icon={Mail}
          iconColor={theme.colors.info}
          title="Email us"
          subtitle={email}
          trailing="chevron"
          onPress={emailUs}
        />
        <SettingsRow
          icon={MessageCircle}
          iconColor={theme.colors.brand}
          title="WhatsApp"
          subtitle="Chat with our support team"
          trailing="chevron"
          onPress={whatsAppUs}
        />
        <SettingsRow
          icon={ClipboardList}
          title="My tickets"
          subtitle="Everything you have raised, and our replies"
          trailing="chevron"
          onPress={() => navigation.navigate('MyTickets')}
        />
      </SettingsList>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
        <Clock size={14} color={theme.colors.textTertiary} />
        <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
          Support available 24/7
        </Text>
      </View>

      <View style={{ gap: 12, marginTop: 2 }}>
        <Text weight="semibold" style={{ fontSize: 16, lineHeight: 22 }}>
          Send us a message
        </Text>
        {booking ? (
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
            About your booking {booking.reference} — it is attached to this ticket.
          </Text>
        ) : null}
        <TextField
          label="Subject"
          value={subject}
          onChangeText={setSubject}
          placeholder="What's it about?"
        />

        <View style={{ gap: 8 }}>
          <Text color="secondary" style={{ fontSize: 13 }}>
            Category
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SUPPORT_CATEGORIES.map((option) => {
              const selected = category === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setCategory(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.brand : theme.colors.border,
                    backgroundColor: selected ? theme.colors.brandTint : theme.colors.card,
                  }}
                >
                  <Text
                    color={selected ? 'brand' : 'secondary'}
                    style={{ fontSize: 13, lineHeight: 18 }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextField
          label="Message"
          value={message}
          onChangeText={setMessage}
          placeholder="Describe your issue…"
          multiline
        />
        <Button
          label={createTicket.isPending ? 'Sending…' : 'Send Message'}
          fullWidth
          disabled={!canSend || createTicket.isPending}
          onPress={send}
        />
      </View>
    </SubScreen>
  );
}

type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]['value'];
