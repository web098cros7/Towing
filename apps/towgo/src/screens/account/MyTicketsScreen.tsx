import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Button, StatusBadge, Text } from '@towing/ui';
import { ChevronRight } from '@/icons';
import { SubScreen } from '@/components/SubScreen';
import { SettingsList } from '@/components/SettingsList';
import { SettingsRow } from '@/components/SettingsRow';
import { useSupportTickets } from '@/features/support/api/support.queries';
import { STATUS_LABEL, STATUS_TONE } from '@/features/support/lib/statusDisplay';
import { formatRelativeTime } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';

/**
 * My Tickets (W15, §9.4.12) — what you raised and where it stands.
 *
 * The list exists because a support conversation that lives only in an email
 * thread or a push notification is one the requester cannot find again. Each
 * row opens the thread, where the answer and the reply box are.
 */
export function MyTicketsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, isLoading, isError, refetch, isRefetching } = useSupportTickets();

  const items = data?.items ?? [];

  return (
    <SubScreen title="My Tickets" gap={16}>
      {isLoading ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      ) : isError ? (
        <View style={{ gap: 12, paddingVertical: 16 }}>
          <Text color="secondary">
            We could not load your tickets just now. Check your connection and try again.
          </Text>
          <Button
            label={isRefetching ? 'Retrying…' : 'Try again'}
            fullWidth
            disabled={isRefetching}
            onPress={() => void refetch()}
          />
        </View>
      ) : items.length === 0 ? (
        <View style={{ gap: 12, paddingVertical: 16 }}>
          <Text color="secondary">
            You have not raised a ticket yet. If something goes wrong with a trip, the fastest way
            is to write to us from Contact Us — the ticket lands with the details attached.
          </Text>
          <Button
            label="Contact support"
            fullWidth
            onPress={() => navigation.navigate('ContactUs')}
          />
        </View>
      ) : (
        <SettingsList>
          {items.map((ticket) => (
            <SettingsRow
              key={ticket.id}
              title={ticket.subject}
              subtitle={`${ticket.reference} · ${formatRelativeTime(ticket.createdAt)}`}
              onPress={() => navigation.navigate('TicketThread', { ticketId: ticket.id })}
              trailing={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <StatusBadge
                    label={STATUS_LABEL[ticket.status]}
                    tone={STATUS_TONE[ticket.status]}
                  />
                  <ChevronRight size={18} color={theme.colors.textTertiary} strokeWidth={2} />
                </View>
              }
            />
          ))}
        </SettingsList>
      )}
    </SubScreen>
  );
}
