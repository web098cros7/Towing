import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { MiColorIconName } from '../icons/colorIcons';
import { MiLineIcon } from '../icons/MiLineIcon';
import { mitowColors } from '../tokens/colors';
import { mitowRadii, mitowShadows } from '../tokens/layout';
import { MiColorIcon } from './MiColorIcon';
import { MiStatusBadge, type MiStatusBadgeStatus } from './MiStatusBadge';
import { MiText } from './MiText';
import { towTruckArtSource } from './MiServiceRow';
import { SlotBar } from './SlotBar';

/**
 * Media slot of a Booking Card. Three drawn forms (the Figma component's `Media` swaps):
 * - `tow`  — the 226-vector Tow Truck art in a 64 × 33.832 box, `contain` (instance `245:1109`,
 *            and the `476:18351` leftover, which keeps the art despite its title).
 * - `tyre` — `icon/color/tyre` at 52 × 39 in a 52 × 40 box (`327:12100`).
 * - `icon` — any other `icon/color/*` at the size its Home tile draws it
 *            (`SERVICE_TILES`, `screens/home/HomeScreen.tsx`).
 */
export type MiBookingCardMedia =
  { kind: 'tow' } | { kind: 'tyre' } | { kind: 'icon'; name: MiColorIconName; size: number };

export type MiBookingCardProps = {
  /** Status Badge (`243:832`). Drives the card's badge, not its media. */
  status: MiStatusBadgeStatus;
  /** "12 Mar 2025, 10:15 AM", MiTow/Body S 14 text/secondary. Null = the drawn box holds a bar. */
  date: string | null;
  /** The service's name ("Tow a Car"), MiTow/Medium 16 text/primary, one line, clipped. */
  title: string | null;
  /** "MG Road → Indiranagar", MiTow/Body S 14 text/secondary, one line. */
  route: string | null;
  /**
   * The fare ("₹1,200"), MiTow/Strong 16 text/primary, hugging. A cancelled card shows the
   * design's em dash rather than a fare. Null = a placeholder bar.
   */
  price: string | null;
  /** Which media the card draws. */
  media: MiBookingCardMedia;
  /**
   * Figma Title box width, used only while `title` is missing. Default 207, the widest box
   * drawn (`245:1175`).
   */
  titleSlotWidth?: number;
  /** Figma Route box width, used only while `route` is missing. Default 207. */
  routeSlotWidth?: number;
  /** Figma Date box width, used only while `date` is missing. Default 153 (`476:18354`). */
  dateSlotWidth?: number;
  /** Figma Price box width, used only while `price` is missing. Default 51 (`245:1160`). */
  priceSlotWidth?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Booking Card, the `Bookings` instance set `245:1109` on 33 · My Bookings: a 351 × 106
 * surface/page card, 1.2 border/subtle border, radius 16, MiTow/Elevation/Card, padding 12
 * top/bottom and 12 left / 10 right, gap 12 between its header and its body.
 *
 * - Header (329 × 28, `pr` 6): the Status Badge, then the date pushed to the right edge.
 * - Body (329 × 42): media (64-wide slot), then the 42-tall Text column (Title over Route,
 *   gap 2, clipping), then the Trailing group — the fare and a 20 px `icon/chevron-right`,
 *   gap 2 — pinned to the right edge.
 *
 * The Text column is drawn with a KNOWN width in Figma (the count of instances whose text box
 * is 207 wide) while the body also carries a 10 pt gap before the trailing group; laying it out
 * `flex: 1` with a 10 gap reproduces all five instances' geometry and needs no per-instance
 * width.
 *
 * Pressable through `usePressablePrimitive()` with the shared card press scale; not a
 * `MiCard`, because the card's asymmetric horizontal padding and internal gaps are its own.
 */
export function MiBookingCard({
  status,
  date,
  title,
  route,
  price,
  media,
  titleSlotWidth = 207,
  routeSlotWidth = 207,
  dateSlotWidth = 153,
  priceSlotWidth = 51,
  onPress,
  accessibilityLabel,
  style,
}: MiBookingCardProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  const label = accessibilityLabel ?? [title, route, date, price].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={[
        {
          backgroundColor: mitowColors.surfacePage,
          borderWidth: 1.2,
          borderColor: mitowColors.borderSubtle,
          borderRadius: mitowRadii.card,
          // Figma: 12 / 10 / 12 / 12 with the 1.2 stroke inside; RN's border takes layout space, so each padding is 1.2 less (as MiCard's users do).
          paddingTop: 10.8,
          paddingBottom: 10.8,
          paddingLeft: 10.8,
          paddingRight: 8.8,
          gap: 12,
          ...mitowShadows.card,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingRight: 6,
        }}
      >
        <MiStatusBadge status={status} />
        {date ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1}>
            {date}
          </MiText>
        ) : (
          <SlotBar variant="bodyS14" width={dateSlotWidth} />
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <BookingMedia media={media} />
        <View style={{ flex: 1, gap: 2, overflow: 'hidden' }}>
          {title ? (
            <MiText variant="medium16" numberOfLines={1} ellipsizeMode="tail">
              {title}
            </MiText>
          ) : (
            <SlotBar variant="medium16" width={titleSlotWidth} />
          )}
          {route ? (
            <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="tail">
              {route}
            </MiText>
          ) : (
            <SlotBar variant="bodyS14" width={routeSlotWidth} />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {price ? (
            <MiText variant="strong16" numberOfLines={1}>
              {price}
            </MiText>
          ) : (
            <SlotBar variant="strong16" width={priceSlotWidth} />
          )}
          <MiLineIcon name="chevron-right" size={20} />
        </View>
      </View>
    </Pressable>
  );
}

/** The 64-wide media slot: every form centres in a box this wide except the 52-wide tyre. */
function BookingMedia({ media }: { media: MiBookingCardMedia }) {
  if (media.kind === 'tow') {
    return (
      <View style={{ width: 64, height: 33.832 }}>
        <Image
          source={towTruckArtSource}
          resizeMode="contain"
          style={{ width: '100%', height: '100%' }}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }
  if (media.kind === 'tyre') {
    return (
      <View style={{ width: 52, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <MiColorIcon name="tyre" size={52} />
      </View>
    );
  }
  return (
    <View style={{ width: 64, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <MiColorIcon name={media.name} size={media.size} />
    </View>
  );
}
