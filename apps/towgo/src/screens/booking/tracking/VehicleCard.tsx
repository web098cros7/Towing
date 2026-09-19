import React from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon, MiText, mitowColors, mitowRadii } from '@/design';
import { SlotPlaceholder } from './SlotPlaceholder';

/** Tow Truck art: vector group `327:17808` exported tight at 90 × 47.58 (@1x/@2x/@3x). */
const towTruckArt = require('./assets/vehicle-tow-truck.png');

/** Figma draws the card's children from its OUTER edge; RN absolute offsets start inside the 1.2 border. */
const BORDER = 1.2;

/** Figma text box widths: plate "KA 01 AB 1234" 110, model "Tata 407 (Flatbed)" 119. */
const PLATE_BOX_WIDTH = 110;
const MODEL_BOX_WIDTH = 119;

/**
 * Figma Vehicle Card (`234:337`), instance `234:339` on 18 · Driver En Route.
 *
 * 74.2 tall, surface/page, 1.2 border/subtle, radius 16, no shadow. Truck art
 * 90 × 47.58 at (12, 13.31); plate (Strong 16) over model (Body S 14 secondary)
 * at (112.6, 17.1); icon/chevron-right 24 at (318.6, 25.1). The chevron makes it
 * tappable: it opens the booking's details.
 *
 * Both lines are always drawn. A plate or model the server has not provided (or
 * the first read has not brought yet) keeps its line with a placeholder bar, so
 * the model never sits under an empty plate line and no copy is invented.
 *
 * 20 · Booking Details (instance `239:663`) hides the chevron (`I239:663;234:336`)
 * and the card is not tappable there: pass `showChevron={false}` and no `onPress`.
 * The text column keeps its 206.4 width; the freed space stays empty, as drawn.
 * With `onPress` (18, 19, 23) the card renders exactly as before.
 */
export function VehicleCard({
  plate,
  model,
  onPress,
  showChevron = true,
}: {
  plate: string | null;
  model: string | null;
  /** Makes the card pressable (18: opens Booking Details). Omit for a static card (20). */
  onPress?: () => void;
  /** icon/chevron-right 24 at (318.6, 25.1). Default true; 20 hides it. */
  showChevron?: boolean;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  const label = ['Tow truck', plate, model].filter(Boolean).join(', ');

  const cardStyle = {
    height: 74.2,
    backgroundColor: mitowColors.surfacePage,
    borderWidth: BORDER,
    borderColor: mitowColors.borderSubtle,
    borderRadius: mitowRadii.card,
    overflow: 'hidden',
  } as const;

  const content = (
    <>
      <Image
        source={towTruckArt}
        resizeMode="stretch"
        style={{
          position: 'absolute',
          left: 12 - BORDER,
          top: 13.31 - BORDER,
          width: 90,
          height: 47.58,
        }}
      />

      <View
        style={{
          position: 'absolute',
          left: 112.6 - BORDER,
          top: 17.1 - BORDER,
          // 206.4 wide on the 351 card: 32 of the right edge stays clear for the chevron.
          right: 32 - BORDER,
          overflow: 'hidden',
        }}
      >
        {plate ? (
          <MiText variant="strong16" numberOfLines={1} ellipsizeMode="clip">
            {plate}
          </MiText>
        ) : (
          <SlotPlaceholder variant="strong16" width={PLATE_BOX_WIDTH} />
        )}
        {model ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
            {model}
          </MiText>
        ) : (
          <SlotPlaceholder variant="bodyS14" width={MODEL_BOX_WIDTH} />
        )}
      </View>

      {showChevron ? (
        <MiLineIcon
          name="chevron-right"
          size={24}
          style={{ position: 'absolute', right: 8.4 - BORDER, top: 25.1 - BORDER }}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={cardStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={`${label}. View booking details`}
      style={cardStyle}
    >
      {content}
    </Pressable>
  );
}
