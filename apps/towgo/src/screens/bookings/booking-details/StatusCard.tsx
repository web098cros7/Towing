import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon, MiText, MiTruckThumb, mitowColors, mitowRadii } from '@/design';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';

/** Figma text box width of the subtitle sample "Arriving in 5 mins" (Body XS 13.5). */
const SUBTITLE_BOX_WIDTH = 106;

/**
 * Status card `239:567`: an Info Banner `224:14` instance with the icon slot
 * swapped to Truck Thumb `238:490`.
 *
 * 351 × 72 (fixed; the master is 67), padding 8 / 8, gap 8, items centred,
 * radius 14, brand/yellow-soft, no border or shadow. Thumb 49 × 49 (radius 10,
 * baked into the asset). Text column fills the width and clips: title Strong 15.5,
 * subtitle Body XS 13.5 secondary. icon/chevron-right 24, 8 from the right edge.
 *
 * Screen-local rather than `MiInfoBanner`, with identical geometry, for one
 * reason: the subtitle is an ETA that can be unknown on the first read, and
 * `MiInfoBanner` takes only a string. Here the line keeps its slot with 18's
 * placeholder bar instead of inventing copy.
 *
 * Pressable (card press scale, light haptic) only when `onPress` is set; the
 * chevron is drawn with it. See the screen for which statuses that is. Its
 * screen-reader label ends with `actionLabel`.
 */
export function StatusCard({
  title,
  subtitle,
  onPress,
  actionLabel = 'Open live tracking',
}: {
  title: string;
  /** `null` holds the line open with a placeholder bar. */
  subtitle: string | null;
  onPress?: () => void;
  /**
   * What the press does, for screen readers (appended to the title and subtitle). Default "Open
   * live tracking"; a completed, unpaid trip's card opens 27 Payment and says so.
   */
  actionLabel?: string;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 72,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: mitowRadii.cardSm,
    backgroundColor: mitowColors.brandYellowSoft,
  };

  const content = (
    <>
      <MiTruckThumb size={49} />
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <MiText variant="strong155" numberOfLines={1} ellipsizeMode="clip">
          {title}
        </MiText>
        {subtitle !== null ? (
          <MiText variant="bodyXS135" color="secondary" numberOfLines={1} ellipsizeMode="clip">
            {subtitle}
          </MiText>
        ) : (
          <SlotPlaceholder variant="bodyXS135" width={SUBTITLE_BOX_WIDTH} />
        )}
      </View>
      {onPress ? <MiLineIcon name="chevron-right" size={24} /> : null}
    </>
  );

  const label = subtitle !== null ? `${title}. ${subtitle}` : title;

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={style}>
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
      accessibilityLabel={`${label}. ${actionLabel}`}
      style={style}
    >
      {content}
    </Pressable>
  );
}
