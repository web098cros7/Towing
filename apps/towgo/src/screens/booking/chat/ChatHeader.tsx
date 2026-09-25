import React from 'react';
import { View } from 'react-native';
import { usePressablePrimitive } from '@towing/ui';
import { MiLineIcon, MiMapButton, MiText, mitowColors } from '@/design';
import { DriverPhoto } from '@/features/booking/components/DriverInfoCard';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import {
  vehiclePlateLabel,
  type TrackedDriverDisplay,
} from '@/screens/booking/tracking/trackingDisplay';

/** Figma text box widths: name "Rakesh Kumar" 107, vehicle line "Tata 407 · KA 01 AB 1234" 163. */
const NAME_BOX_WIDTH = 107;
const VEHICLE_BOX_WIDTH = 163;
const PHOTO_SIZE = 42;

/**
 * Figma 22's vehicle line, "Tata 407 · KA 01 AB 1234": `<make> <model> · <plate>`,
 * the " · " (U+00B7 between two spaces) static.
 *
 * 18's `vehicleModelLabel` is not reused: it adds the body type ("Tata 407
 * (Flatbed)"), which 22 does not draw. The parts are the same data 18 reads: the
 * app-local make and model (mock only, 22 Data gap 2) and the contract's plate
 * through 18's `vehiclePlateLabel`. With a part missing, what is known is shown
 * ("KA 01 AB 1234" alone); `null`, and a placeholder bar, only when nothing is.
 */
export function chatVehicleLabel(driver: TrackedDriverDisplay | null): string | null {
  const makeModel = [driver?.vehicleMake?.trim(), driver?.vehicleModel?.trim()]
    .filter(Boolean)
    .join(' ');
  const plate = vehiclePlateLabel(driver);
  return [makeModel, plate].filter(Boolean).join(' · ') || null;
}

/**
 * Header `292:2631`: 393 × 64, surface/page, a 1 px border/subtle BOTTOM border
 * (inside, in layout, so the children centre in the upper 63), padding 16 left /
 * 21 right, gap 12, items centred.
 *
 * - Back `292:2632`: a bare icon/chevron-left 24 (stroke 2.4), no circle or border.
 * - IMG-01 · Driver photo `292:2634`: 42 circle. With no photo (or before the first
 *   read) it stays an empty surface/muted circle, as on 18 (22 Data gap 4).
 * - Driver `292:2635`: column, width FILL (210), gap 1. Name Strong 16, vehicle line
 *   Body S 14 secondary. Single lines that clip (22 Data gap 16); unknown values
 *   keep their drawn width with a placeholder bar.
 * - Call `292:2638`: Icon Button (Outline) resized to 44, icon/phone 26.
 *
 * Not drawn, so not built: a title, a Help chip, a Message button, a presence dot,
 * an overflow menu.
 */
export function ChatHeader({
  driver,
  onBack,
  onCall,
}: {
  driver: TrackedDriverDisplay | null;
  onBack: () => void;
  onCall: () => void;
}) {
  const Pressable = usePressablePrimitive();
  const vehicle = chatVehicleLabel(driver);

  return (
    <View
      style={{
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 16,
        paddingRight: 21,
        backgroundColor: mitowColors.surfacePage,
        borderBottomWidth: 1,
        borderBottomColor: mitowColors.borderSubtle,
      }}
    >
      {/* 24 box; the hit slop makes the target 50 × 44 without reaching the photo. */}
      <Pressable
        onPress={onBack}
        pressScale={0.9}
        haptic="light"
        hitSlop={{ top: 10, bottom: 10, left: 16, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={{ width: 24, height: 24 }}
      >
        <MiLineIcon name="chevron-left" size={24} />
      </Pressable>

      <DriverPhoto
        driver={driver ? { name: driver.name, photoUrl: driver.photoUrl ?? null } : null}
        size={PHOTO_SIZE}
      />

      <View style={{ flex: 1, gap: 1 }}>
        {driver ? (
          <MiText variant="strong16" numberOfLines={1} ellipsizeMode="clip">
            {driver.name}
          </MiText>
        ) : (
          <SlotPlaceholder variant="strong16" width={NAME_BOX_WIDTH} />
        )}
        {vehicle ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
            {vehicle}
          </MiText>
        ) : (
          <SlotPlaceholder variant="bodyS14" width={VEHICLE_BOX_WIDTH} />
        )}
      </View>

      <MiMapButton
        variant="outline"
        icon="phone"
        size={44}
        iconSize={26}
        accessibilityLabel="Call driver"
        onPress={onCall}
      />
    </View>
  );
}
