import React, { useEffect, useMemo, useRef } from 'react';
import { Modal, PanResponder, StyleSheet, View } from 'react-native';
import Animated, {
  SlideInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@towing/theme';
import { MiButton, MiCard, MiColorIcon, MiSheetPanel, MiText, mitowColors } from '@/design';
import { MiModalFrame } from '@/design/components/MiModalFrame';
import { formatPaise } from '@/utils/format';
import { towMethodLabelFor } from '../data/towTypes.data';
import type { FareEstimate } from '../types';
import { fareSubtitleText, formatKm, type RouteFacts } from './book-a-tow/routeCopy';

/** A drag past this many points, or a downward fling, dismisses the sheet. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.9;

/**
 * Figma 15 · Fare Breakdown, sheet `292:2793`, modal over 14.
 *
 * Dim (surface/inverse 45 %) + sheet (padding 14 / 21 / 34, gap 16): handle,
 * heading block (gap 4), breakdown card (padding 16, gap 14, radius 16, 1.2
 * border/subtle, Elevation/Card), note row (gap 10, top-aligned) and the dark
 * "Got It" button. No close button, no second CTA.
 *
 * Every drawn part renders on every open. The values come from the quote on
 * screen; if the query drops it while the sheet is open, the sheet keeps the
 * last one it showed.
 *
 * `MiSheet` has no drag gesture, so the modal is assembled here from the same
 * parts (RN Modal, the Dim, `MiSheetPanel`, the same slide-in) plus the drawn
 * handle's drag-down-to-dismiss. Tap outside does nothing: the design does not
 * specify it.
 */
export function FareBreakdownSheet({
  visible,
  onClose,
  estimate,
  vehicleName,
  vehicleClass,
  route,
}: {
  visible: boolean;
  onClose: () => void;
  estimate: FareEstimate | undefined;
  /** The selected 14 vehicle tile's name ("Car"), for "Tow a Car · …". */
  vehicleName: string;
  /** The class the selected tile bills, for the tow method until a quote names one. */
  vehicleClass: 'wheel_lift' | 'flatbed';
  /** Distance and ETA for the subtitle and the distance row. */
  route: RouteFacts;
}) {
  const theme = useTheme();

  const lastEstimate = useRef<FareEstimate | undefined>(estimate);
  if (estimate) lastEstimate.current = estimate;
  const shown = estimate ?? lastEstimate.current;

  // --- drag to dismiss -----------------------------------------------------

  const translateY = useSharedValue(0);
  const panelHeight = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

  const panResponder = useMemo(() => {
    const close = () => onCloseRef.current();
    const settle = () => {
      translateY.value = withSpring(0, theme.motion.spring.press);
    };
    return PanResponder.create({
      // Vertical drags only, and only downward: the Got It press keeps its own touch.
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        translateY.value = Math.max(0, g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          translateY.value = withTiming(panelHeight.current || 480, { duration: 180 }, (done) => {
            if (done) runOnJS(close)();
          });
        } else {
          settle();
        }
      },
      onPanResponderTerminate: settle,
    });
  }, [theme.motion.spring.press, translateY]);

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <MiModalFrame style={{ justifyContent: 'flex-end' }}>
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: mitowColors.dim }]}
          accessible={false}
          importantForAccessibility="no"
        />
        <Animated.View entering={SlideInDown.duration(280)}>
          <Animated.View
            style={dragStyle}
            accessibilityViewIsModal
            accessibilityLabel="Fare breakdown"
            onLayout={(event) => {
              panelHeight.current = event.nativeEvent.layout.height;
            }}
            {...panResponder.panHandlers}
          >
            <MiSheetPanel>
              <FareBreakdownBody
                estimate={shown}
                vehicleName={vehicleName}
                vehicleClass={vehicleClass}
                route={route}
              />
              <MiButton label="Got It" onPress={onClose} />
            </MiSheetPanel>
          </Animated.View>
        </Animated.View>
      </MiModalFrame>
    </Modal>
  );
}

function FareBreakdownBody({
  estimate,
  vehicleName,
  vehicleClass,
  route,
}: {
  estimate: FareEstimate | undefined;
  vehicleName: string;
  vehicleClass: 'wheel_lift' | 'flatbed';
  route: RouteFacts;
}) {
  const breakdown = estimate?.breakdown;
  const money = (paise: number | undefined) => (paise === undefined ? '' : formatPaise(paise));

  const distancePaise = breakdown ? (breakdown.distancePaise ?? 0) : undefined;
  /**
   * The four drawn lines must add up to "Total estimate". The quote also carries
   * charges the design draws no row for (highway pickup, accident recovery,
   * waiting, surge), and the live API folds distance into base. The Base fare
   * line therefore carries everything that is not drawn on a line of its own:
   * total − distance − night + discount.
   */
  const basePaise = breakdown
    ? Math.max(
        0,
        breakdown.totalPaise -
          (distancePaise ?? 0) -
          breakdown.nightPaise +
          breakdown.discountPaise,
      )
    : undefined;

  return (
    <>
      <View style={{ gap: 4 }}>
        <MiText variant="title23">Fare breakdown</MiText>
        <MiText variant="bodyM15" color="secondary" numberOfLines={1}>
          {fareSubtitleText(
            route,
            vehicleName,
            towMethodLabelFor(estimate?.vehicleClass ?? vehicleClass),
          )}
        </MiText>
      </View>

      <MiCard radius={16} padding={16} gap={14} borderWidth={1.2} elevation="card">
        {/* The live API folds distance into the base fare: then there is no
            separate distance line ("₹0" read as a bug), and the base fare names
            the distance it covers. */}
        {distancePaise ? (
          <>
            <LineItem label="Base fare" value={money(basePaise)} />
            <LineItem
              label={`Distance charge (${formatKm(route.distanceKm)} km)`}
              value={money(distancePaise)}
            />
          </>
        ) : (
          <LineItem
            label={route.distanceKm ? `Base fare (${formatKm(route.distanceKm)} km)` : 'Base fare'}
            value={money(basePaise)}
          />
        )}
        <LineItem label="Night charge" value={money(breakdown?.nightPaise)} />
        <LineItem
          label={estimate?.couponCode ? `Discount (${estimate.couponCode})` : 'Discount'}
          // U+2212 MINUS SIGN, then ₹ and the amount, as drawn.
          value={breakdown ? `−${formatPaise(breakdown.discountPaise)}` : ''}
          credit
        />

        <View style={{ height: 1, backgroundColor: mitowColors.borderSubtle }} />

        <View
          style={{
            height: 26,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <MiText variant="strong16">Total estimate</MiText>
          <MiText variant="title20">{money(breakdown?.totalPaise)}</MiText>
        </View>
      </MiCard>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <MiColorIcon name="info" size={20} />
        <MiText variant="bodyS14" color="secondary" style={{ flex: 1 }}>
          Fare locks when you confirm. Until then it may change with demand, tolls or waiting time.
        </MiText>
      </View>
    </>
  );
}

/**
 * A line item row `292:2800`…`292:2809`: exactly 20 tall, space-between, items
 * centred, nothing between label and value. Body M 15 secondary label, Strong 15
 * value (status/success-text for the credit).
 */
function LineItem({ label, value, credit }: { label: string; value: string; credit?: boolean }) {
  return (
    <View
      style={{
        height: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Single line, as the drawn nowrap label; it yields before the value does. */}
      <MiText variant="bodyM15" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </MiText>
      <MiText variant="strong15" color={credit ? 'success' : 'primary'} align="right">
        {value}
      </MiText>
    </View>
  );
}
