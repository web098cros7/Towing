import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorState, usePressablePrimitive } from '@towing/ui';
import type { NotificationDto } from '@towing/api-contracts';
import {
  MiColorIcon,
  MiNavBar,
  MiScreen,
  MiText,
  mitowColors,
  mitowLayout,
  mitowRadii,
  mitowShadows,
  noNotificationsIllustration,
} from '@/design';
import type { MiColorIconName } from '@/design';
import { track } from '@/lib/analytics/analytics';
import {
  useMarkNotificationsRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/api/notifications.queries';
import type { RootStackParamList } from '@/navigation/types';

/** Figma 281:1741 — Notification Row. */
const ROW_PADDING_VERTICAL = 14;
const ROW_PADDING_HORIZONTAL = 12.8; // Figma 14 minus the 1.2 stroke
const ROW_GAP = 12;
const ICON_HOLDER_SIZE = 48;
const ICON_SIZE = 30;
const UNREAD_DOT_SIZE = 8;

/** Figma 287:2137 — List card. */
const CARD_BORDER_WIDTH = 1.2;
const CARD_PADDING_VERTICAL = 0.8; // Figma 2 minus the 1.2 stroke
const DIVIDER_HEIGHT = 1;
const DIVIDER_MARGIN_LEFT = 72.8; // Figma 74 minus the 1.2 stroke

/** Figma 390:18380 — Empty state. */
const EMPTY_PADDING_TOP = 142.5;
const EMPTY_ILLUSTRATION_WIDTH = 315;
const EMPTY_ILLUSTRATION_HEIGHT = 197.5;
const EMPTY_TEXT_MARGIN_TOP = 64;
const EMPTY_TEXT_MAX_WIDTH = 319;

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Figma's time label form: "2 min ago", "12 min ago", "3h ago", "2d ago",
 * "5d ago", otherwise day number + short month ("12 Mar").
 */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(then);
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function iconForNotification(notification: NotificationDto): MiColorIconName {
  const { event, category } = notification;
  if (event === 'driver.kyc.approved') return 'verified';
  if (event.startsWith('payment.')) return 'payment';
  if (event === 'booking.confirmed') return 'calendar';
  if (event.includes('assigned') || event.includes('driver')) return 'tow-truck';
  if (category === 'promotions' || event.includes('offer') || event.includes('coupon')) {
    return 'tag';
  }
  return 'bell';
}

interface NotificationRowProps {
  notification: NotificationDto;
}

/** Figma 281:1741 — Notification Row. */
function NotificationRow({ notification }: NotificationRowProps) {
  const unread = notification.readAt === null;
  const time = timeAgo(notification.createdAt);
  const accessibilityLabel = `${unread ? 'Unread. ' : ''}${notification.title}. ${notification.body}. ${time}`;

  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.row}>
      <View
        style={[
          styles.iconHolder,
          { backgroundColor: unread ? mitowColors.brandYellowSoft : mitowColors.surfaceMuted },
        ]}
      >
        <MiColorIcon name={iconForNotification(notification)} size={ICON_SIZE} />
      </View>
      <View style={styles.textColumn}>
        <MiText variant="strong15" numberOfLines={1}>
          {notification.title}
        </MiText>
        <MiText variant="bodyS14" color="secondary">
          {notification.body}
        </MiText>
        <MiText variant="label13" color="placeholder">
          {time}
        </MiText>
      </View>
      {unread ? <View style={styles.unreadDot} /> : null}
    </View>
  );
}

interface NotificationSectionProps {
  title: string;
  items: NotificationDto[];
}

function NotificationSection({ title, items }: NotificationSectionProps) {
  return (
    <View style={styles.section}>
      <MiText variant="heading18">{title}</MiText>
      <View style={styles.card}>
        {items.map((item, index) => (
          <React.Fragment key={item.id}>
            <NotificationRow notification={item} />
            {index < items.length - 1 ? <View style={styles.divider} /> : null}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * Figma 36 · Notifications (`287:1855`) with its empty state
 * 37 · Notifications · Empty (`301:4679`).
 *
 * The list reads `notifications` rows, never delivery receipts (invariant 74):
 * a message that reached no push token, went out on the log adapter, or was
 * aimed at a revoked device still belongs here.
 */
export function NotificationsScreen() {
  const Pressable = usePressablePrimitive();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const query = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkNotificationsRead();

  React.useEffect(() => {
    track('notification_opened');
  }, []);

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const hasUnread = (unread.data?.unread ?? 0) > 0;

  const today = items.filter((item) => isToday(item.createdAt));
  const earlier = items.filter((item) => !isToday(item.createdAt));

  const handleScroll = React.useCallback(
    (event: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceFromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceFromEnd < 200 && query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    [query],
  );

  const showEmpty = !query.isPending && !query.isError && items.length === 0;

  return (
    <MiScreen edges={['top']} backgroundColor={mitowColors.surfacePage}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 34) },
        ]}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.navBarRow}>
          <MiNavBar title="Notifications" trailing="none" onBack={navigation.goBack} />
          {hasUnread ? (
            <Pressable
              onPress={() => markRead.mutate(undefined)}
              hitSlop={10}
              pressScale={1}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel="Mark all notifications as read"
              style={styles.markAllRead}
            >
              <MiText variant="strong14" color="brand">
                Mark all read
              </MiText>
            </Pressable>
          ) : null}
        </View>

        {query.isPending ? null : query.isError && items.length === 0 ? (
          <ErrorState
            title="Could not load notifications"
            body="Check your connection and try again."
            onRetry={() => void query.refetch()}
          />
        ) : showEmpty ? (
          <View style={styles.emptyState}>
            <SvgXml
              xml={noNotificationsIllustration}
              width={EMPTY_ILLUSTRATION_WIDTH}
              height={EMPTY_ILLUSTRATION_HEIGHT}
            />
            <View style={styles.emptyTextBlock}>
              <MiText variant="title23" align="center">
                No Notifications Yet
              </MiText>
              <MiText variant="bodyL155" color="secondary" align="center">
                We'll notify you about your bookings, driver updates, offers and more.
              </MiText>
            </View>
          </View>
        ) : (
          <>
            {today.length > 0 ? <NotificationSection title="Today" items={today} /> : null}
            {earlier.length > 0 ? <NotificationSection title="Earlier" items={earlier} /> : null}
          </>
        )}
      </ScrollView>
    </MiScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: mitowLayout.sideMargin,
    gap: mitowLayout.blockGap,
  },
  navBarRow: {
    height: 46,
    position: 'relative',
  },
  markAllRead: {
    position: 'absolute',
    right: 0,
    top: 14,
  },
  section: {
    gap: mitowLayout.headingGap,
  },
  card: {
    backgroundColor: mitowColors.surfacePage,
    borderWidth: CARD_BORDER_WIDTH,
    borderColor: mitowColors.borderSubtle,
    borderRadius: mitowRadii.card,
    paddingVertical: CARD_PADDING_VERTICAL,
    overflow: 'hidden',
    ...mitowShadows.card,
  },
  divider: {
    height: DIVIDER_HEIGHT,
    marginLeft: DIVIDER_MARGIN_LEFT,
    backgroundColor: mitowColors.borderSubtle,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: ROW_GAP,
    paddingVertical: ROW_PADDING_VERTICAL,
    paddingHorizontal: ROW_PADDING_HORIZONTAL,
  },
  iconHolder: {
    width: ICON_HOLDER_SIZE,
    height: ICON_HOLDER_SIZE,
    borderRadius: mitowRadii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: 3,
  },
  unreadDot: {
    width: UNREAD_DOT_SIZE,
    height: UNREAD_DOT_SIZE,
    borderRadius: mitowRadii.pill,
    backgroundColor: mitowColors.brandYellow,
    marginTop: 6,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: EMPTY_PADDING_TOP,
  },
  emptyTextBlock: {
    marginTop: EMPTY_TEXT_MARGIN_TOP,
    maxWidth: EMPTY_TEXT_MAX_WIDTH,
    gap: 6,
    alignItems: 'center',
  },
});
