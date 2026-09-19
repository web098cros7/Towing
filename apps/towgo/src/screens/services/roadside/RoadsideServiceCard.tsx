import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  colorIconSources,
  mitowColors,
  mitowRadii,
  mitowShadows,
  MiColorIcon,
  MiLineIcon,
  MiText,
} from '@/design';
import type { RoadsideService } from './roadsideServices.data';

/**
 * Service Card (`258:1481`) as instanced six times on 09's grid (`259:1627`),
 * built from the component's own values:
 *
 * - white, radius 14, MiTow/Elevation/Card, a 1.2 border/subtle stroke drawn as
 *   an overlay so it takes no layout space (Figma: "Top" at 10/12, card 117 tall);
 * - padding 12 top and bottom, 10 left, 8 right, column gap 10;
 * - "Top" row: colour icon 64 left, icon/chevron-right 20 top-right, clipped;
 * - "Text": one MiTow/Strong 14 title, gap 2. The hidden subtitle is not drawn.
 *
 * Screen-local rather than `MiServiceCard` because every card is drawn with a
 * ONE-LINE title and every row with two 117-tall cards. `MiServiceCard` lets the
 * title wrap, so on the common Android widths below 393 (360, 384) "Minor
 * Mechanical Help" (149 wide at Strong 14) no longer fits its 136–148 box, wraps
 * to two lines and makes its card taller than "Tow a Car". Here the title keeps
 * one line and scales down only by the fraction it overflows (about 1–2%), so
 * the copy stays whole and the rows stay even. At 393 nothing is scaled.
 */
export function RoadsideServiceCard({
  service,
  onPress,
  style,
}: {
  service: RoadsideService;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={service.title}
      style={[
        {
          backgroundColor: mitowColors.surfacePage,
          borderRadius: mitowRadii.cardSm,
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 10,
          paddingRight: 8,
          gap: 10,
          alignItems: 'flex-start',
          ...mitowShadows.card,
        },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: mitowRadii.cardSm,
          borderWidth: 1.2,
          borderColor: mitowColors.borderSubtle,
        }}
      />

      <View
        style={{
          alignSelf: 'stretch',
          height: 64,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          overflow: 'hidden',
        }}
      >
        {service.icon === 'tow-truck' ? (
          <TowTruckArt />
        ) : (
          <MiColorIcon name={service.icon} size={64} />
        )}
        <MiLineIcon name="chevron-right" size={20} />
      </View>

      <View style={{ alignSelf: 'stretch', gap: 2, overflow: 'hidden' }}>
        <MiText
          variant="strong14"
          numberOfLines={1}
          ellipsizeMode="clip"
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {service.title}
        </MiText>
      </View>
    </Pressable>
  );
}

/**
 * "Tow a Car" icon frame `366:19363` (detached): a 64 box that does not clip,
 * holding art `366:19364` at 76.29×40.33 from (0, 8.5), overflowing 12.3 to the
 * right (the wider "Top" row does the clipping). The PNG's art spans the full
 * 192 width and rows 45–146, so the square image is drawn 76.29 wide and
 * shifted up by 45 × 76.29 / 192 − 8.5.
 */
const TRUCK_ART = 76.29;
const TRUCK_TOP = 8.5 - (45 * TRUCK_ART) / 192;

function TowTruckArt() {
  return (
    <View style={{ width: 64, height: 64, overflow: 'visible' }}>
      <Image
        source={colorIconSources['tow-truck']}
        resizeMode="contain"
        style={{
          position: 'absolute',
          left: 0,
          top: TRUCK_TOP,
          width: TRUCK_ART,
          height: TRUCK_ART,
        }}
        accessibilityIgnoresInvertColors
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </View>
  );
}
