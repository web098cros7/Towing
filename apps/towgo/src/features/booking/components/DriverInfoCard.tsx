import React from 'react';
import { Image, View } from 'react-native';
import { MiLineIcon, MiMapButton, MiText, mitowColors, mitowRadii } from '@/design';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';

/**
 * What the row renders. Shaped after the API: `photoUrl` is nullable because the
 * server returns null for a driver with no photo yet.
 */
export type DriverCardInfo = {
  name: string;
  photoUrl: string | null;
};

/** Figma text box widths: name "Rakesh Kumar" 107, rating "4.8 (500+ trips)" 101. */
const NAME_BOX_WIDTH = 107;
const RATING_BOX_WIDTH = 101;
const PHOTO_SIZE = 73;

/**
 * Figma Driver Row (`234:308`), instance `234:315` on 18 · Driver En Route.
 *
 * Not a card: no fill, border or shadow. Row 77 tall, padding left 0.7 / top 4,
 * gap 11.7, items centred. Photo 73 circle; info column gap 3.5 with the name
 * (Strong 16) over the rating row (icon/star 16.3 brand/yellow, gap 5.1, Body S
 * 14 secondary). Actions: two Icon Button (Outline) 55 circles, gap 5, aligned to
 * the top with 4 bottom padding. Call = icon/phone, Message = icon/message.
 *
 * Every drawn element is always rendered. A slot whose value is not known yet
 * (first read) or not provided (no photo, unrated driver) keeps its drawn size:
 * the photo circle stays as an empty surface/muted circle, text slots show a
 * placeholder bar. No fallback art and no invented copy.
 */
export function DriverInfoCard({
  driver,
  ratingText,
  onCall,
  onMessage,
}: {
  driver: DriverCardInfo | null;
  /** The rating line as drawn, e.g. "4.8 (500+ trips)"; `null` holds the slot. */
  ratingText: string | null;
  onCall: () => void;
  onMessage: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 77,
        paddingLeft: 0.7,
        paddingTop: 4,
        gap: 11.7,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: PHOTO_SIZE,
          height: PHOTO_SIZE,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfaceMuted,
          overflow: 'hidden',
        }}
      >
        {driver?.photoUrl ? (
          <Image
            source={{ uri: driver.photoUrl }}
            resizeMode="cover"
            style={{ width: PHOTO_SIZE, height: PHOTO_SIZE }}
            accessibilityLabel={`${driver.name}'s photo`}
          />
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 3.5, overflow: 'hidden' }}>
        {driver ? (
          <MiText variant="strong16" numberOfLines={1} ellipsizeMode="clip">
            {driver.name}
          </MiText>
        ) : (
          <SlotPlaceholder variant="strong16" width={NAME_BOX_WIDTH} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5.1 }}>
          <MiLineIcon name="star" size={16.3} color={mitowColors.brandYellow} />
          {ratingText ? (
            <MiText
              variant="bodyS14"
              color="secondary"
              numberOfLines={1}
              ellipsizeMode="clip"
              style={{ flexShrink: 1 }}
            >
              {ratingText}
            </MiText>
          ) : (
            <View style={{ flexShrink: 1 }}>
              <SlotPlaceholder variant="bodyS14" width={RATING_BOX_WIDTH} />
            </View>
          )}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingBottom: 4 }}>
        <MiMapButton
          variant="outline"
          icon="phone"
          accessibilityLabel="Call driver"
          onPress={onCall}
        />
        <MiMapButton
          variant="outline"
          icon="message"
          accessibilityLabel="Message driver"
          onPress={onMessage}
        />
      </View>
    </View>
  );
}
