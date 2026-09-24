import React, { useCallback, useRef } from 'react';
import { Keyboard, ScrollView, View, type TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mitowLayout, MiButton, MiNavBar, MiScreen } from '@/design';
import { LocationFields } from '@/features/booking/components/LocationFields';
import { BookingPills } from '@/features/booking/components/BookingPills';
import { LocationActions } from '@/features/booking/components/enter-location/LocationActions';
import { PlaceSuggestions } from '@/features/booking/components/enter-location/PlaceSuggestions';
import { SavedRecentSection } from '@/features/booking/components/enter-location/SavedRecentSection';
import {
  useRecentPlaces,
  useRecentPlacesStore,
} from '@/features/booking/components/enter-location/recentPlacesStore';
import {
  useSavedPlaces,
  type SavedPlaceRow,
} from '@/features/booking/components/enter-location/useSavedPlaces';
import { useLocationEditing } from '@/features/booking/components/enter-location/useLocationEditing';
import { locationValue, type RecentLocation } from '@/features/booking/data/recentLocations.data';
import type { RootStackParamList } from '@/navigation/types';

/** Figma 10: Continue's bottom edge sits 43 above the 852 frame bottom (34 of it the home-indicator zone). */
const CONTINUE_BOTTOM = 43;
const INDICATOR_ZONE = 34;

/**
 * Figma 10 · Enter Location (289:2029), with sheets 11 (Schedule a Tow) and 12
 * (Who's the Tow For) opened from the pills.
 *
 * Column (side margin 21, gap 16): Nav bar → Pills → Locations card → Actions →
 * Saved & Recent. Continue is pinned at the bottom, independent of the column.
 * While the customer types in Pickup or Drop, the matching places replace
 * Actions and Saved & Recent (owner decision, 24 Sep 2026; Figma draws no
 * search list). No error line is drawn.
 */
export function BookLocationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const pickupRef = useRef<TextInput | null>(null);
  const dropRef = useRef<TextInput | null>(null);
  const editing = useLocationEditing({ pickupRef, dropRef });

  const saved = useSavedPlaces();
  const recents = useRecentPlaces();
  const clearRecents = useRecentPlacesStore((s) => s.clearRecents);

  const { selectPlace, discardDrafts, finish } = editing;

  const onSelectSaved = useCallback(
    (row: SavedPlaceRow) => {
      if (!row.place) {
        // No address saved under this name yet (real backend only): Add Location.
        Keyboard.dismiss();
        navigation.navigate('AddSavedLocation');
        return;
      }
      selectPlace(locationValue(row.place), row.place.coords);
    },
    [navigation, selectPlace],
  );

  const onSelectRecent = useCallback(
    (place: RecentLocation) => selectPlace(locationValue(place), place.coords),
    [selectPlace],
  );

  // 13 Pick on Map is drawn for the PICKUP only ("PICKUP LOCATION" /
  // "Confirm pickup", which sets the pickup), so it always opens for the pickup.
  // No drop variant is drawn (13 spec Data gap 1); the drop is searched on 10.
  const onSelectOnMap = useCallback(() => {
    discardDrafts();
    Keyboard.dismiss();
    navigation.navigate('MapPicker', { field: 'pickup' });
  }, [discardDrafts, navigation]);

  const onContinue = useCallback(async () => {
    // Drawn at full strength in every state: an incomplete route moves focus to
    // the field that still needs a place instead of dimming the button.
    if (await finish()) navigation.navigate('BookTow');
  }, [finish, navigation]);

  const footerBottom = Math.max(CONTINUE_BOTTOM, insets.bottom + CONTINUE_BOTTOM - INDICATOR_ZONE);

  return (
    <MiScreen
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingTop: 12,
            paddingBottom: footerBottom,
          }}
        >
          <MiButton label="Continue" onPress={() => void onContinue()} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: mitowLayout.sideMargin }}>
        <MiNavBar title="Enter Location" onBack={() => navigation.goBack()} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          paddingTop: mitowLayout.blockGap,
          paddingBottom: mitowLayout.blockGap,
          gap: mitowLayout.blockGap,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <BookingPills />

        <LocationFields
          pickupInputRef={pickupRef}
          dropInputRef={dropRef}
          pickupText={editing.pickupText}
          dropText={editing.dropText}
          onChangeText={editing.onChangeText}
          onFocusField={editing.onFocusField}
          onBlurField={editing.onBlurField}
          onLocate={() => void editing.locate()}
          onSwap={editing.swap}
          locating={editing.locating}
        />

        {editing.searchingField ? (
          <PlaceSuggestions suggestions={editing.suggestions} onSelect={editing.selectSuggestion} />
        ) : (
          <>
            <LocationActions
              onSelectOnMap={onSelectOnMap}
              // Drawn enabled. Bookings carry one pickup and one drop (no stops in
              // the contract) and no add-stop screen is drawn, so the press gives
              // its feedback and goes nowhere yet.
              onAddStop={() => {}}
            />

            <SavedRecentSection
              saved={saved}
              recents={recents}
              onSelectSaved={onSelectSaved}
              onSelectRecent={onSelectRecent}
              onClearRecents={clearRecents}
            />
          </>
        )}
      </ScrollView>
    </MiScreen>
  );
}
