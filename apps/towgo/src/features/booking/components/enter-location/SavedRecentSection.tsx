import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, mitowShadows, MiColorIcon, MiText, type MiColorIconName } from '@/design';
import type { RecentLocation, SavedLocationKind } from '../../data/recentLocations.data';
import type { SavedPlaceRow } from './useSavedPlaces';

const SAVED_ICON: Record<SavedLocationKind, MiColorIconName> = {
  home: 'home',
  work: 'briefcase',
};

/** Menu row 238:520 as screen 10 draws it: 56 tall (8 + 40 + 8 around the 34 icon). */
const ROW_HEIGHT = 56;

/**
 * One Saved & Recent row: padding 8 / 10 right / 8 / 14 left, gap 14, 34 colour
 * icon, text column flex 1 (gap 1, clips) with Body M 15 title and Body S 14
 * subtitle. No chevron, nothing trailing.
 *
 * Built here rather than with MiMenuRow because that component lets a long
 * title or address wrap and grow the row past the drawn 56. Each line here is
 * single, ending in an ellipsis when it overflows (the design does not settle
 * overflow; the Text Field component's values use the same ellipsis).
 */
function PlaceRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: MiColorIconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.row}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={{
        height: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingLeft: 14,
        paddingRight: 10,
        paddingVertical: 8,
      }}
    >
      <MiColorIcon name={icon} size={34} />
      <View style={{ flex: 1, gap: 1, overflow: 'hidden' }}>
        <MiText variant="bodyM15" numberOfLines={1}>
          {title}
        </MiText>
        {subtitle ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1}>
            {subtitle}
          </MiText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Divider 289:2264: 1px border/subtle, inset 62 (14 + 34 + 14). */
function Divider() {
  return <View style={{ height: 1, marginLeft: 62, backgroundColor: mitowColors.borderSubtle }} />;
}

/**
 * Figma 10 "Saved & recent" (289:2243): header (title + "Clear recents") over
 * the Menu card (289:2247: radius 16, 1.2 border/subtle, padding 4, Elevation/Card).
 * Saved rows first (icon/color/home, icon/color/briefcase), then recent rows
 * (icon/color/recent). The card is always drawn: Home and Work are always
 * rows, so it is never empty.
 */
export function SavedRecentSection({
  saved,
  recents,
  onSelectSaved,
  onSelectRecent,
  onClearRecents,
}: {
  saved: SavedPlaceRow[];
  recents: RecentLocation[];
  onSelectSaved: (row: SavedPlaceRow) => void;
  onSelectRecent: (place: RecentLocation) => void;
  onClearRecents: () => void;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  const rows: React.ReactNode[] = [
    ...saved.map((row) => (
      <PlaceRow
        key={`saved-${row.kind}`}
        icon={SAVED_ICON[row.kind]}
        title={row.title}
        subtitle={row.place?.address}
        onPress={() => onSelectSaved(row)}
      />
    )),
    ...recents.map((place) => (
      <PlaceRow
        key={`recent-${place.id}`}
        icon="recent"
        title={place.name}
        subtitle={place.address || undefined}
        onPress={() => onSelectRecent(place)}
      />
    )),
  ];

  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          height: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <MiText variant="heading18">{'Saved & Recent'}</MiText>
        <Pressable
          onPress={onClearRecents}
          pressScale={theme.motion.pressScale.chip}
          haptic="light"
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear recents"
        >
          <MiText variant="strong14" color="brand">
            Clear recents
          </MiText>
        </Pressable>
      </View>

      <View
        style={{
          backgroundColor: mitowColors.surfacePage,
          borderRadius: 16,
          borderWidth: 1.2,
          borderColor: mitowColors.borderSubtle,
          paddingVertical: 4,
          ...mitowShadows.card,
        }}
      >
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {row}
            {i < rows.length - 1 ? <Divider /> : null}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}
