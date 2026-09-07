import React from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text, type IconComponent } from '@towing/ui';
import { Star, Truck, Phone, MessageCircle } from '@/icons';
import { Pressable } from '@/motion';

/**
 * What the card renders.
 *
 * SHAPED AFTER THE API, NOT AFTER THE MOCK IT USED TO TAKE (Phase 18). Two of
 * these were non-nullable because the frozen fixture always had them:
 *
 *  · `photoUrl` replaced an `ImageSourcePropType`. The server returns a URL or
 *    null; a bundled asset was only ever the placeholder.
 *  · `rating` is nullable. A driver nobody has rated has NO rating, and
 *    defaulting to 5.0 advertises one that does not exist — the same call
 *    `jobOfferSchema` makes for `customerRating`. §6.2 will not have a real
 *    writer for it until Phase 19 either way.
 */
export type DriverCardInfo = {
  name: string;
  photoUrl: string | null;
  rating: number | null;
  trips: number;
  vehiclePlate: string | null;
};

function ActionCircle({
  icon: Icon,
  bg,
  color,
  label,
  caption,
  onPress,
}: {
  icon: IconComponent;
  bg: string;
  color: string;
  /** Screen-reader label — stays explicit so VoiceOver doesn't read "Call, Call". */
  label: string;
  /** Visible text under the circle. */
  caption: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={() => ({
        alignItems: 'center',
        gap: theme.spacing.xs,
      })}
    >
      <View
        style={{
          width: theme.sizes.control.tapTarget,
          height: theme.sizes.control.tapTarget,
          borderRadius: theme.sizes.control.tapTarget / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={theme.sizes.icon.md + 2} color={color} strokeWidth={2} />
      </View>
      <Text variant="micro" color="secondary">
        {caption}
      </Text>
    </Pressable>
  );
}

export function DriverInfoCard({
  driver,
  vehicleLabel,
  onCall,
  onMessage,
}: {
  driver: DriverCardInfo;
  vehicleLabel: string;
  onCall: () => void;
  /**
   * OPTIONAL, and omitted by the tracking screen (Phase 18). In-app chat is
   * deferred to Phase 20 — §17 has no messages table — and a button that opens
   * nothing is worse than a button that is not there. The masked call satisfies
   * §9.1.7 contact requirement on its own.
   */
  onMessage?: () => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: theme.radii.sheet,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.lg,
        ...theme.shadows.card,
      }}
    >
      <Image
        // A null URL renders the tinted circle alone rather than a broken-image
        // glyph: most drivers have no photo, so the empty state is the common one.
        source={driver.photoUrl ? { uri: driver.photoUrl } : undefined}
        style={{
          width: theme.sizes.avatar.lg,
          height: theme.sizes.avatar.lg,
          borderRadius: theme.sizes.avatar.lg / 2,
          backgroundColor: theme.colors.brandTint,
        }}
        accessibilityLabel={`${driver.name}'s photo`}
      />

      <View style={{ flex: 1, gap: 6 }}>
        <Text variant="subtitle" weight="bold" numberOfLines={1}>
          {driver.name}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {/*
            A driver with no rating gets NO pill rather than a 5.0 one — see
            `DriverCardInfo`. Phase 19 writes the first real values.
          */}
          {driver.rating !== null ? (
          <View
            accessible
            accessibilityLabel={`Rated ${driver.rating.toFixed(1)} out of 5`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              backgroundColor: theme.colors.brandTint,
              borderRadius: theme.radii.pill,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 3,
            }}
          >
            <Star size={theme.sizes.icon.xs} color={theme.colors.star} fill={theme.colors.star} />
            <Text variant="caption" weight="bold" tabular>
              {driver.rating.toFixed(1)}
            </Text>
          </View>
          ) : null}
          <Text variant="caption" color="secondary">
            ({driver.trips} trips)
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Truck size={theme.sizes.icon.sm} color={theme.colors.textSecondary} strokeWidth={2} />
          <Text variant="body" weight="semibold" numberOfLines={1}>
            {driver.vehiclePlate ?? "Vehicle details to follow"}
          </Text>
        </View>
        <Text variant="caption" color="secondary" numberOfLines={1}>
          {vehicleLabel}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.lg }}>
        <ActionCircle
          icon={Phone}
          bg={theme.colors.successSoftBg}
          color={theme.colors.success}
          label="Call driver"
          caption="Call"
          onPress={onCall}
        />
        {onMessage ? (
          <ActionCircle
            icon={MessageCircle}
            bg={theme.colors.infoSoftBg}
            color={theme.colors.info}
            label="Message driver"
            caption="Message"
            onPress={onMessage}
          />
        ) : null}
      </View>
    </View>
  );
}
