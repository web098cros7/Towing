import React from 'react';
import {
  Image,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MiText } from './MiText';
import { SlotBar } from './SlotBar';

/**
 * The 226-vector Tow Truck art (Vehicle Card `327:17808`; the same group is baked into Service
 * Row `243:872` as `327:13714` and drawn on 25's ETA banner as `319:7996`), exported tight at
 * 90 × 47.58: @1x 90 × 48, @2x 180 × 95, @3x 270 × 143, RGBA, corners alpha 0. The app's one
 * copy of the art: 18's Vehicle Card and 25's ETA banner draw it from here too.
 */
export const towTruckArtSource: ImageSourcePropType = require('../../assets/images/vehicle-tow-truck.png');

export type MiServiceRowProps = {
  /**
   * Title#243:23. MiTow/Strong 16, text/primary, one line, clipped. `null` (or '') holds the
   * slot open with a placeholder bar `titleSlotWidth` wide.
   */
  title: string | null;
  /**
   * Subtitle#243:24. MiTow/Body S 14, text/secondary, one line, clipped. 27 / 28 draw the master
   * default "Standard towing service"; 30 draws the truck model "Tata 407 (Flatbed)". `null` (or
   * '') = a placeholder bar `subtitleSlotWidth` wide.
   */
  subtitle: string | null;
  /**
   * Price#243:25 ("₹1,200"). MiTow/Strong 16, text/primary, hugs; its right edge is the row's.
   * `null` (or '') = a placeholder bar `priceSlotWidth` wide.
   */
  price: string | null;
  /** Figma Title box width, used only while `title` is missing. Default 75 ("Tow a Car"). */
  titleSlotWidth?: number;
  /**
   * Figma Subtitle box width, used only while `subtitle` is missing. Default 157 (27's
   * "Standard towing service"); 30 passes 119 ("Tata 407 (Flatbed)").
   */
  subtitleSlotWidth?: number;
  /** Figma Price box width, used only while `price` is missing. Default 51 ("₹1,200"). */
  priceSlotWidth?: number;
  /** Default: the known values joined with ", " ("Tow a Car, Tata 407 (Flatbed), ₹1,200"). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Service Row (`243:872`, 323 × 40, no description): horizontal, gap 12, items centred, no
 * padding, no fill, height hugs.
 * - Truck art: a 64 × 33.832 box, `contain` (the art's ratio 90 / 47.58).
 * - Text column: flex 1, gap 0, clips. Title over subtitle, single lines clipped with no
 *   ellipsis (Figma: auto-width texts in a clipping frame).
 * - Price: hugs, one line, last in the row.
 *
 * Instances: 27 `243:878` and 28's backdrop copy `299:4042` ("Tow a Car" / "Standard towing
 * service" / "₹1,200"), 30 `245:1034` ("Tow a Car" / "Tata 407 (Flatbed)" / "₹1,200"), and 35
 * `245:955`. The component's `Media#243:26` swap (default Truck Thumb `238:490`) is ORPHANED:
 * no layer consumes it, so there is no media prop and the truck is always drawn. Never use the
 * Truck Thumb here.
 *
 * Not pressable; read by screen readers as one element.
 */
export function MiServiceRow({
  title,
  subtitle,
  price,
  titleSlotWidth = 75,
  subtitleSlotWidth = 157,
  priceSlotWidth = 51,
  accessibilityLabel,
  style,
}: MiServiceRowProps) {
  const label = accessibilityLabel ?? [title, subtitle, price].filter(Boolean).join(', ');
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}
    >
      <Image
        source={towTruckArtSource}
        resizeMode="contain"
        style={{ width: 64, height: 33.832 }}
        accessibilityIgnoresInvertColors
      />
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {title ? (
          <MiText variant="strong16" numberOfLines={1} ellipsizeMode="clip">
            {title}
          </MiText>
        ) : (
          <SlotBar variant="strong16" width={titleSlotWidth} />
        )}
        {subtitle ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
            {subtitle}
          </MiText>
        ) : (
          <SlotBar variant="bodyS14" width={subtitleSlotWidth} />
        )}
      </View>
      {price ? (
        <MiText variant="strong16" numberOfLines={1}>
          {price}
        </MiText>
      ) : (
        <SlotBar variant="strong16" width={priceSlotWidth} />
      )}
    </View>
  );
}
