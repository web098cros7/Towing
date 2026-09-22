import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useTheme } from '@towing/theme';
import { MapPreview } from '@towing/ui';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiButton,
  MiLineIcon,
  MiStatusBadge,
  MiMapButton,
  MiChip,
  MiTextField,
  mitowColors,
} from '@/design';
import {
  useAddresses,
  useCreateAddress,
  useUpdateAddress,
  useDeleteAddress,
} from '@/features/account/api/addresses.queries';
import { placesDataSource } from '@/features/places/api/placesDataSource';
import type { RootStackParamList } from '@/navigation/types';

type LocationKind = 'home' | 'work' | 'other';

/**
 * Figma 42 · Add Location (295:3018).
 *
 * Coordinate source: device GPS by default, reverse-geocoded into the address
 * text field. When the customer types an address that differs from the
 * reverse-geocoded text, the typed text is resolved through the places search
 * (`autocomplete` → `details`) and the resolved point is saved instead — so
 * typing "the office" while at home saves the office, not home. A real
 * map-pin picker is a later phase's `BookLocation` rebuild — out of scope here.
 */
export function AddSavedLocationScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddSavedLocation'>>();
  const locationId = route.params?.locationId;

  const { data: addresses, isPending: addressesPending } = useAddresses();
  const createAddress = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const deleteAddress = useDeleteAddress();

  const existing = locationId ? addresses?.find((a) => a.id === locationId) : undefined;

  const [kind, setKind] = useState<LocationKind>('home');
  const [otherLabel, setOtherLabel] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [seeded, setSeeded] = useState(!locationId);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [addressFocused, setAddressFocused] = useState(false);
  const [resolving, setResolving] = useState(false);
  // The address text that came from a GPS fix or the existing saved location.
  // If the customer edits the field away from this, the typed text must be
  // resolved through the places search before saving.
  const resolvedAddressRef = useRef<string | null>(null);

  useEffect(() => {
    if (existing && !seeded) {
      const raw = (existing.label ?? '').trim();
      const lower = raw.toLowerCase();
      if (lower === 'home') {
        setKind('home');
      } else if (lower === 'work') {
        setKind('work');
      } else {
        setKind('other');
        setOtherLabel(raw);
      }
      setAddress(existing.fullAddress);
      resolvedAddressRef.current = existing.fullAddress;
      setCoords({ lat: existing.lat, lng: existing.lng });
      setSeeded(true);
    }
  }, [existing, seeded]);

  const useCurrentLocation = async () => {
    setLocating(true);
    setLocationDenied(false);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync();
      const { latitude, longitude } = position.coords;
      setCoords({ lat: latitude, lng: longitude });

      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (place) {
          const parts = [place.name, place.street, place.city, place.region].filter(Boolean);
          if (parts.length > 0) {
            const resolved = parts.join(', ');
            setAddress(resolved);
            resolvedAddressRef.current = resolved;
          }
        }
      } catch {
        // Reverse geocoding is a nicety — the coordinates are already captured either way.
      }
    } finally {
      setLocating(false);
    }
  };

  // A create screen defaults to the device fix so most saves need zero manual location work.
  useEffect(() => {
    if (!locationId) useCurrentLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const canSave = address.trim().length > 0;
  const save = async () => {
    const typed = address.trim();
    if (!typed) return;

    // If the typed text matches what the GPS fix (or the existing saved
    // location) put in the field, the current `coords` are already correct.
    // Otherwise the customer typed somewhere else — resolve it via places.
    let saveCoords = coords;
    if (typed !== (resolvedAddressRef.current ?? '').trim()) {
      setResolving(true);
      try {
        const autocomplete = await placesDataSource.autocomplete(
          typed,
          coords ? { latitude: coords.lat, longitude: coords.lng } : undefined,
        );
        const prediction = autocomplete.predictions[0];
        if (!prediction) {
          Alert.alert(
            "We couldn't find that address",
            'Check the address, or use your current location.',
          );
          return;
        }
        const detail = await placesDataSource.details(prediction.placeId);
        saveCoords = { lat: detail.point.lat, lng: detail.point.lng };
      } catch {
        Alert.alert(
          "We couldn't find that address",
          'Check the address, or use your current location.',
        );
        return;
      } finally {
        setResolving(false);
      }
    }

    if (!saveCoords) return;

    const label =
      kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : otherLabel.trim() || 'Other';
    // Data gap: the saved-address contract has no landmark field, so the
    // landmark is folded into `fullAddress` until the schema grows one.
    const fullAddress = landmark.trim() ? `${typed}, ${landmark.trim()}` : typed;
    const data = { label, fullAddress, lat: saveCoords.lat, lng: saveCoords.lng };
    if (locationId) {
      updateAddress.mutate(
        { addressId: locationId, patch: data },
        { onSuccess: () => navigation.goBack() },
      );
    } else {
      createAddress.mutate(data, { onSuccess: () => navigation.goBack() });
    }
  };
  const del = () => {
    if (locationId) deleteAddress.mutate(locationId, { onSuccess: () => navigation.goBack() });
  };

  const saving = createAddress.isPending || updateAddress.isPending || resolving;

  if (locationId && addressesPending) {
    return (
      <MiScreen edges={['top']}>
        <View style={{ paddingHorizontal: 21 }}>
          <MiNavBar title="Edit Location" trailing="none" onBack={() => navigation.goBack()} />
        </View>
      </MiScreen>
    );
  }

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: 21,
            paddingBottom: Math.max(insets.bottom, 43),
          }}
        >
          {/* Figma 295:3223 — Save Location */}
          <MiButton
            tone="dark"
            label="Save Location"
            onPress={save}
            disabled={!canSave}
            loading={saving}
          />
        </View>
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 21,
          gap: 16,
          paddingBottom: 24,
        }}
      >
        {/* Figma 295:3018 — nav bar (Figma draws only the add state) */}
        <MiNavBar
          title={locationId ? 'Edit Location' : 'Add Location'}
          trailing="none"
          onBack={() => navigation.goBack()}
        />

        {/* Figma 295:3185 — map preview */}
        <View
          style={{
            height: 170,
            width: '100%',
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: mitowColors.surfaceMuted,
          }}
        >
          {coords ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <MapPreview
                style={StyleSheet.absoluteFill}
                region={{
                  latitude: coords.lat,
                  longitude: coords.lng,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                }}
                showRecenter={false}
                showUserLocation={false}
                label=""
              />
            </View>
          ) : null}

          {/* Figma 295:3188 — centre pin */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: '50%',
              marginLeft: -18,
              top: 55,
            }}
          >
            <MiLineIcon name="map-pin" size={36} />
          </View>

          {/* Figma 295:3190 — "Location captured" */}
          {coords ? (
            <View style={{ position: 'absolute', left: 12, top: 130 }}>
              <MiStatusBadge status="completed" label="Location captured" />
            </View>
          ) : null}

          {/* Figma 295:3192 — use current location */}
          <View style={{ position: 'absolute', right: 12, top: 118 }}>
            <MiMapButton
              icon="locate"
              size={40}
              iconSize={24}
              accessibilityLabel="Use current location"
              onPress={useCurrentLocation}
              disabled={locating}
            />
          </View>
        </View>

        {/* Figma 295:3197 — Save as */}
        <View style={{ gap: 12 }}>
          <MiText variant="medium16">Save as</MiText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <MiChip label="Home" selected={kind === 'home'} onPress={() => setKind('home')} />
            <MiChip label="Work" selected={kind === 'work'} onPress={() => setKind('work')} />
            <MiChip label="Other" selected={kind === 'other'} onPress={() => setKind('other')} />
          </View>
        </View>

        {/* Figma 295:3206 — Address (Text Area 281:1717, counter hidden) */}
        <View style={{ gap: 8 }}>
          <MiText variant="medium16">Address</MiText>
          <View
            style={{
              height: 124,
              borderRadius: 14,
              borderWidth: addressFocused ? 1.5 : 1.2,
              borderColor: addressFocused ? mitowColors.brandYellow : mitowColors.borderSubtle,
              backgroundColor: mitowColors.surfacePage,
              paddingTop: 12.8,
              paddingHorizontal: 12.8,
              paddingBottom: 10.8,
            }}
          >
            <TextInput
              multiline
              textAlignVertical="top"
              value={address}
              onChangeText={setAddress}
              onFocus={() => setAddressFocused(true)}
              onBlur={() => setAddressFocused(false)}
              placeholder="Enter full address"
              placeholderTextColor={mitowColors.textPlaceholder}
              accessibilityLabel="Address"
              style={{
                flex: 1,
                fontSize: 15,
                lineHeight: 20,
                letterSpacing: -0.225,
                color: mitowColors.textPrimary,
                fontFamily: theme.fonts.regular,
                padding: 0,
              }}
            />
          </View>
        </View>

        {/* Figma 295:3211 — Landmark */}
        <MiTextField
          label="Landmark (optional)"
          value={landmark}
          onChangeText={setLandmark}
          placeholder="e.g. Near Trinity Metro Station"
          autoCapitalize="words"
        />

        {locationDenied ? (
          <MiText variant="bodyS14" color="danger">
            Location access denied — enable it in Settings, or the address can't be saved.
          </MiText>
        ) : null}

        {/* Not drawn in Figma — kept so a saved place can still be removed. */}
        {locationId ? (
          <MiButton
            tone="dangerSoft"
            label="Delete Location"
            onPress={del}
            loading={deleteAddress.isPending}
          />
        ) : null}
      </ScrollView>
    </MiScreen>
  );
}
