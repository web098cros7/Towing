import React, { useMemo, useState } from 'react';
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
import { Button, Screen, Text } from '@towing/ui';
import type { SupportTicketCategory } from '@towing/api-contracts';
import { DriverHeader } from '@/components/DriverHeader';
import { Pressable } from '@/motion';
import { useCreateTicket } from '@/features/support/api/support.queries';
import type { RootStackParamList } from '@/navigation/types';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';

const CATEGORIES: { value: SupportTicketCategory; label: string }[] = [
  { value: 'booking', label: 'A job' },
  { value: 'payment', label: 'Payment' },
  { value: 'kyc', label: 'Documents' },
  { value: 'app', label: 'The app' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Something else' },
];

export function SupportNewTicketScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'SupportNewTicket'>>();
  const bookingId = route.params?.bookingId;

  const create = useCreateTicket();

  const [category, setCategory] = useState<SupportTicketCategory>(
    bookingId ? 'booking' : 'other',
  );
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const canSend = useMemo(
    () => subject.trim().length >= 4 && body.trim().length >= 4 && !create.isPending,
    [subject, body, create.isPending],
  );

  const onSend = () => {
    if (!canSend) return;
    create.mutate(
      {
        category,
        subject: subject.trim(),
        body: body.trim(),
        ...(bookingId ? { bookingId } : {}),
      },
      {
        onSuccess: (result) => {
          navigation.replace('SupportTicket', { ticketId: result.ticketId });
        },
        onError: () => {
          Alert.alert('Could not send', 'Please try again.');
        },
      },
    );
  };

  return (
    <Screen edges={['top']} contentContainerStyle={{ flex: 1 }}>
      <DriverHeader
        leading="back"
        title="New request"
        onLeading={() => navigation.goBack()}
        showBell={false}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {bookingId ? (
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
              About job {bookingId.slice(0, 8).toUpperCase()}
            </Text>
          ) : null}

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: INK_SOFT }}>
              What is this about?
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map((c) => {
                const selected = c.value === category;
                return (
                  <Pressable
                    key={c.value}
                    onPress={() => setCategory(c.value)}
                    haptic="light"
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={() => ({
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? theme.colors.textPrimary : HAIRLINE,
                      backgroundColor: selected ? theme.colors.textPrimary : theme.colors.surface0,
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: '500',
                        color: selected ? '#FFFFFF' : theme.colors.textPrimary,
                      }}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: INK_SOFT }}>Subject</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Short summary"
              placeholderTextColor="#9CA3AF"
              maxLength={160}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: HAIRLINE,
                backgroundColor: theme.colors.surface1,
                color: theme.colors.textPrimary,
                fontSize: 15,
                lineHeight: 20,
              }}
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: INK_SOFT }}>Message</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Tell us what happened"
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={4000}
              textAlignVertical="top"
              style={{
                minHeight: 140,
                paddingHorizontal: 12,
                paddingVertical: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: HAIRLINE,
                backgroundColor: theme.colors.surface1,
                color: theme.colors.textPrimary,
                fontSize: 15,
                lineHeight: 21,
              }}
            />
          </View>

          <Button
            label={create.isPending ? 'Sending…' : 'Send'}
            onPress={onSend}
            disabled={!canSend}
            loading={create.isPending}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
