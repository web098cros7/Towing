import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { usePressablePrimitive } from '@towing/ui';
import { useTheme } from '@towing/theme';
import {
  MiSheet,
  MiText,
  MiButton,
  MiColorIcon,
  mitowColors,
  type MiColorIconName,
} from '@/design';

// Figma 55 · Appearance — bottom sheet 301:4427 over Settings

export type AppearanceChoice = 'light' | 'dark' | 'system';

type AppearanceOption = {
  value: AppearanceChoice;
  icon: MiColorIconName;
  title: string;
  subtitle: string;
  /** No theme for it yet: shown, dimmed, not pickable. */
  comingSoon?: boolean;
};

const OPTIONS: AppearanceOption[] = [
  { value: 'light', icon: 'sun', title: 'Light', subtitle: 'Bright and clear' },
  // The app is light-only today: Dark and System say so instead of saving a
  // choice that changes nothing (owner, 25 Sep 2026).
  { value: 'dark', icon: 'moon', title: 'Dark', subtitle: 'Coming soon', comingSoon: true },
  { value: 'system', icon: 'device', title: 'System', subtitle: 'Coming soon', comingSoon: true },
];

function AppearanceTile({
  option,
  selected,
  onSelect,
}: {
  option: AppearanceOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const Pressable = usePressablePrimitive();
  const theme = useTheme();

  return (
    <Pressable
      pressScale={theme.motion.pressScale.chip}
      haptic="selection"
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${option.title}, ${option.subtitle}`}
      onPress={onSelect}
      disabled={option.comingSoon}
      style={{
        flex: 1,
        opacity: option.comingSoon ? 0.5 : 1,
        minHeight: 135,
        borderRadius: 14,
        paddingVertical: 10,
        paddingHorizontal: 6,
        gap: 8,
        alignItems: 'center',
        backgroundColor: selected ? mitowColors.brandYellowSoft : mitowColors.surfacePage,
        borderWidth: selected ? 1.5 : 1.2,
        borderColor: selected ? mitowColors.brandYellow : mitowColors.borderSubtle,
      }}
    >
      <MiColorIcon name={option.icon} size={52} />
      <View style={{ gap: 2, alignItems: 'center', width: '100%' }}>
        <MiText variant="strong155" align="center">
          {option.title}
        </MiText>
        <MiText variant="label13" color="secondary" align="center">
          {option.subtitle}
        </MiText>
      </View>
      {selected ? (
        <View
          style={{
            position: 'absolute',
            top: 6.5,
            right: 6.5,
            width: 20,
            height: 20,
            borderRadius: 999,
            backgroundColor: mitowColors.brandYellow,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              backgroundColor: mitowColors.textPrimary,
            }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

export function AppearanceSheet({
  visible,
  value,
  onClose,
  onDone,
}: {
  visible: boolean;
  value: AppearanceChoice;
  onClose: () => void;
  onDone: (choice: AppearanceChoice) => void;
}) {
  const [draft, setDraft] = useState<AppearanceChoice>(value);
  const [wasVisible, setWasVisible] = useState(visible);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(value);
    }
  }

  useEffect(() => {
    if (visible) {
      setDraft(value);
    }
  }, [visible, value]);

  return (
    <MiSheet
      visible={visible}
      onClose={onClose}
      onBackdropPress={onClose}
      accessibilityLabel="Appearance"
    >
      {/* Heading 301:4430 */}
      <View style={{ gap: 4 }}>
        <MiText variant="title23">Appearance</MiText>
        <MiText variant="bodyM15" color="secondary">
          Choose how MiTow looks on this phone.
        </MiText>
      </View>

      {/* Options 301:4433 */}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch' }}>
        {OPTIONS.map((option) => (
          <AppearanceTile
            key={option.value}
            option={option}
            selected={draft === option.value}
            onSelect={() => setDraft(option.value)}
          />
        ))}
      </View>

      {/* Done 301:4436 */}
      <MiButton tone="dark" label="Done" onPress={() => onDone(draft)} />
    </MiSheet>
  );
}
