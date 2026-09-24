import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import Constants from 'expo-constants';
import { useTheme } from '@towing/theme';
import { Text } from '@towing/ui';

const APP_NAME = Constants.expoConfig?.name ?? 'MiTow Driver';

/** Shown while `authStore.hydrate()` reads the persisted session from MMKV (root gate). */
export function SplashScreen() {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.surface0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.lg,
      }}
    >
      <Text weight="bold" style={{ fontSize: 28, color: theme.colors.brand }}>
        {APP_NAME}
      </Text>
      <ActivityIndicator color={theme.colors.brand} />
    </View>
  );
}
