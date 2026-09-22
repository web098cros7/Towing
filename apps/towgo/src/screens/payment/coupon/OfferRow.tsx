import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { MiText, mitowColors, mitowRadii } from '@/design';
import type { CouponOffer } from '@/features/payments/types';
import { useLineBox } from '../paymentDisplay';

/** Code pill `299:4082`: radius 8, 1.2 dashed brand/yellow INSIDE stroke, dash [4, 4]. */
const PILL_RADIUS = 8;
const PILL_STROKE = 1.2;

/**
 * One offer row of 28 · Apply Coupon (`299:4081`, `299:4088`, `299:4095`; plain frames, not a
 * component): surface/page, 1.2 border/subtle INSIDE and IN layout (so RN's border is exact),
 * radius 14, no shadow, row with items centred, padding 12 / 14 right / 12 / 12 left, gap 12.
 * The code pill, a text column (title Body S 14 primary, wrapping; validity Label 13 secondary,
 * one line boxed at 17), then "Applied" (status/success-text, no action) or "Apply" (text/brand,
 * the tap target). The row grows with its title: 63.4 for one line, 82.4 for two.
 */
export function OfferRow({
  offer,
  applied,
  onApply,
}: {
  offer: CouponOffer;
  applied: boolean;
  onApply: () => void;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const validityBox = useLineBox('label13');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 12,
        paddingRight: 14,
        borderRadius: mitowRadii.cardSm,
        borderWidth: 1.2,
        borderColor: mitowColors.borderSubtle,
        backgroundColor: mitowColors.surfacePage,
      }}
    >
      <CouponCodePill code={offer.code} />

      <View style={{ flex: 1, gap: 1 }}>
        <MiText variant="bodyS14">{offer.title}</MiText>
        <MiText
          variant="label13"
          color="secondary"
          numberOfLines={1}
          style={{ minHeight: validityBox }}
        >
          {offer.validity}
        </MiText>
      </View>

      {applied ? (
        <MiText
          variant="strong14"
          color="success"
          numberOfLines={1}
          accessibilityLabel={`${offer.code} applied`}
        >
          Applied
        </MiText>
      ) : (
        // A text link like the field's "Remove": the label is the target, with a generous slop.
        <Pressable
          onPress={onApply}
          pressScale={theme.motion.pressScale.button}
          haptic="light"
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Apply ${offer.code}`}
        >
          <MiText variant="strong14" color="brand" numberOfLines={1}>
            Apply
          </MiText>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Code pill: brand/yellow-soft, radius 8, the label (Strong 14 primary) padded 6 / 10 inside the
 * stroke, i.e. 7.2 / 11.2 from the edge (33.4 tall). RN's `borderStyle: 'dashed'` cannot set the
 * [4, 4] pattern and dashes differently on iOS and Android, so the stroke is an SVG rect on the
 * stroke's centre line (inset 0.6, radius 7.4), butt caps (Figma caps NONE), sized on layout.
 */
function CouponCodePill({ code }: { code: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((previous) =>
          previous && previous.width === width && previous.height === height
            ? previous
            : { width, height },
        );
      }}
      style={{
        paddingVertical: 6 + PILL_STROKE,
        paddingHorizontal: 10 + PILL_STROKE,
        borderRadius: PILL_RADIUS,
        backgroundColor: mitowColors.brandYellowSoft,
      }}
    >
      <MiText variant="strong14" numberOfLines={1}>
        {code}
      </MiText>
      {size ? (
        <Svg
          width={size.width}
          height={size.height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Rect
            x={PILL_STROKE / 2}
            y={PILL_STROKE / 2}
            width={size.width - PILL_STROKE}
            height={size.height - PILL_STROKE}
            rx={PILL_RADIUS - PILL_STROKE / 2}
            ry={PILL_RADIUS - PILL_STROKE / 2}
            fill="none"
            stroke={mitowColors.brandYellow}
            strokeWidth={PILL_STROKE}
            strokeDasharray="4 4"
          />
        </Svg>
      ) : null}
    </View>
  );
}
