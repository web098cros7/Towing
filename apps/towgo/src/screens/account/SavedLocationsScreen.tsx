import React from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorState } from '@towing/ui';
import {
  MiScreen,
  MiNavBar,
  MiMenuCard,
  MiMenuRow,
  MiInfoBanner,
  MiButton,
  mitowLayout,
  type MiColorIconName,
} from '@/design';
import { useAddresses } from '@/features/account/api/addresses.queries';
import type { RootStackParamList } from '@/navigation/types';

/**
 * `SavedAddress` (the backend contract) has no `kind` — just a free-text
 * `label`. Home/Work still get their recognisable icon by matching the label
 * text; anything else falls back to a plain pin.
 */
function iconForLabel(label: string | null): { color: MiColorIconName } {
  const normalized = label?.trim().toLowerCase();
  if (normalized === 'home') return { color: 'home' };
  if (normalized === 'work') return { color: 'briefcase' };
  return { color: 'place' };
}

/**
 * Figma 41 · Saved Locations (294:2944).
 *
 * Layout:
 * - MiNavBar "Saved Locations" (294:3157 header region).
 * - Locations card (294:3157) — MiMenuCard radius 16, paddingVertical 4,
 *   one MiMenuRow per saved address.
 * - Book in one tap banner (294:3215) — MiInfoBanner tone "muted", height 85.
 * - Footer Add Location button (294:3225) — MiButton tone "dark".
 */
export function SavedLocationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { data: addresses, isError, refetch } = useAddresses();

  const hasAddresses = !!addresses && addresses.length > 0;
  const showError = isError && !hasAddresses;

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(insets.bottom, 43),
          }}
        >
          {/* 294:3225 — Add Location button (no icon drawn). */}
          <MiButton
            tone="dark"
            label="Add Location"
            onPress={() => navigation.navigate('AddSavedLocation')}
          />
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        <MiNavBar title="Saved Locations" trailing="none" onBack={() => navigation.goBack()} />

        {showError ? (
          <ErrorState title="Couldn't load your saved locations" onRetry={() => refetch()} />
        ) : hasAddresses ? (
          /* 294:3157 — Locations card. */
          <MiMenuCard radius={16} paddingVertical={4}>
            {(addresses ?? []).map((a) => {
              const title = a.label ?? 'Saved place';
              return (
                <MiMenuRow
                  key={a.id}
                  icon={iconForLabel(a.label)}
                  title={title}
                  subtitle={a.fullAddress}
                  showChevron
                  onPress={() => navigation.navigate('AddSavedLocation', { locationId: a.id })}
                  accessibilityLabel={`${title}, ${a.fullAddress}. Edit`}
                />
              );
            })}
          </MiMenuCard>
        ) : null}

        {/* 294:3215 — Book in one tap banner (not pressable). */}
        <MiInfoBanner
          tone="muted"
          icon="map"
          title="Book in one tap"
          subtitle="Pick a saved place as pickup or drop when you book a tow."
          height={85}
        />
      </ScrollView>
    </MiScreen>
  );
}
