import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, MiColorIcon, MiText, type MiColorIconName } from '@/design';

/** Figma 10 action button (289:2234 / 289:2239): 52 tall, radius 12, 1.2 border/subtle, no shadow. */
function ActionButton({
  icon,
  label,
  onPress,
  accessibilityHint,
}: {
  icon: MiColorIconName;
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.button}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={{
        flex: 1,
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        borderRadius: 12,
        borderWidth: 1.2,
        borderColor: mitowColors.borderSubtle,
        backgroundColor: mitowColors.surfacePage,
      }}
    >
      <MiColorIcon name={icon} size={28} />
      <MiText variant="medium16" numberOfLines={1}>
        {label}
      </MiText>
    </Pressable>
  );
}

/**
 * Figma 10 Actions row (289:2233): "Select on map" and "Add a stop", flex 1
 * each, gap 10. Both are drawn enabled at full strength.
 */
export function LocationActions({
  onSelectOnMap,
  onAddStop,
}: {
  onSelectOnMap: () => void;
  onAddStop: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <ActionButton icon="map" label="Select on map" onPress={onSelectOnMap} />
      <ActionButton icon="add-stop" label="Add a stop" onPress={onAddStop} />
    </View>
  );
}
