import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, EmptyState, ErrorState, Screen, Skeleton, StatusBadge, Text } from '@towing/ui';
import { Headphones, RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { SectionHeading } from '@/components/SectionHeading';
import { Pressable } from '@/motion';
import { Button } from '@towing/ui';
import { useSupportTickets } from '@/features/support/api/support.queries';
import { SUPPORT_STATUS_LABEL, supportStatusTone } from '@/features/support/statusLabel';
import type { RootStackParamList } from '@/navigation/types';
import type { SupportTicketSummary } from '@towing/api-contracts';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * §9.2.5's help surface — the driver's door into the shared support queue.
 *
 * The top card is the whole feature in one sentence: what support is for, and
 * where the answer will appear. A driver who does not know a reply lands back
 * here writes to support and then checks their email for a week.
 */
export function HelpSupportScreen() {
  const navigation = useNavigation<Nav>();
  const { data, isPending, isError, refetch } = useSupportTickets();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 32 }}>
      <DriverHeader
        leading="back"
        title="Help & Support"
        titleSize={22}
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, gap: 18 }}>
        <Card padding={18} bordered style={{ borderRadius: 20, borderColor: '#E5E7EB' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#F3F4F6',
              }}
            >
              <Headphones size={22} />
            </View>
            <Text weight="semibold" style={{ fontSize: 16, lineHeight: 21, flex: 1 }}>
              Need help with a job, a payment or the app?
            </Text>
          </View>

          <Text color="secondary" style={{ fontSize: 14, lineHeight: 20, marginTop: 12 }}>
            Write to MiTow support. Replies show here and as a notification.
          </Text>

          <View style={{ marginTop: 16 }}>
            <Button
              label="New request"
              onPress={() => navigation.navigate('SupportNewTicket')}
            />
          </View>
        </Card>

        <View style={{ gap: 12 }}>
          <SectionHeading title="Your requests" />

          {isError ? (
            <ErrorState
              title="Couldn't load your requests"
              onRetry={() => refetch()}
              icon={RefreshCw}
            />
          ) : isPending ? (
            <>
              <Skeleton width="100%" height={84} radius={20} />
              <Skeleton width="100%" height={84} radius={20} />
            </>
          ) : data && data.length > 0 ? (
            data.map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                onPress={() => navigation.navigate('SupportTicket', { ticketId: ticket.id })}
              />
            ))
          ) : (
            <EmptyState
              icon={Headphones}
              title="No requests yet"
              body="When you write to support, your requests appear here."
            />
          )}
        </View>
      </View>
    </Screen>
  );
}

function TicketRow({
  ticket,
  onPress,
}: {
  ticket: SupportTicketSummary;
  onPress: () => void;
}) {
  const date = new Date(ticket.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <Pressable
      onPress={onPress}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={`${ticket.subject}, ${SUPPORT_STATUS_LABEL[ticket.status]}`}
    >
      <Card padding={18} bordered style={{ borderRadius: 20, borderColor: '#E5E7EB' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="medium" numberOfLines={1} style={{ fontSize: 15, lineHeight: 20 }}>
              {ticket.subject}
            </Text>
            <Text color="secondary" style={{ fontSize: 12, lineHeight: 17 }}>
              {ticket.reference} · {date}
            </Text>
          </View>
          <StatusBadge
            label={SUPPORT_STATUS_LABEL[ticket.status]}
            tone={supportStatusTone(ticket.status)}
          />
        </View>
      </Card>
    </Pressable>
  );
}
