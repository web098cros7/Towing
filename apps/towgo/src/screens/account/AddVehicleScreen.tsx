import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import type { VehicleCategory } from '@towing/api-contracts';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiButton,
  MiColorIcon,
  MiLineIcon,
  MiMenuCard,
  MiTextField,
  MiChip,
  mitowColors,
} from '@/design';
import { Toggle } from '@/components/Toggle';
import {
  useVehicles,
  useCreateVehicle,
  useUpdateVehicle,
  useDeleteVehicle,
  useUploadVehicleRc,
} from '@/features/account/api/vehicles.queries';
import type { RootStackParamList } from '@/navigation/types';

const TYPES: { value: VehicleCategory; label: string }[] = [
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'muv', label: 'MUV' },
  { value: 'luxury', label: 'Luxury' },
  { value: 'bike', label: 'Bike' },
  { value: 'other', label: 'Other' },
];

/**
 * Figma 50 · Add Vehicle — node 294:2920.
 */
export function AddVehicleScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const Pressable = usePressablePrimitive();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddVehicle'>>();
  const vehicleId = route.params?.vehicleId;

  const { data: vehicles, isPending: vehiclesPending } = useVehicles();
  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const deleteVehicle = useDeleteVehicle();
  const uploadRc = useUploadVehicleRc();

  const existing = vehicleId ? vehicles?.find((v) => v.id === vehicleId) : undefined;

  const [type, setType] = useState<VehicleCategory>('hatchback');
  const [makeModel, setMakeModel] = useState('');
  const [plate, setPlate] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [seeded, setSeeded] = useState(!vehicleId);
  const [defaultSeeded, setDefaultSeeded] = useState(false);
  // Picked before the vehicle exists yet — uploaded right after create succeeds.
  const [pendingRcUri, setPendingRcUri] = useState<string | null>(null);

  useEffect(() => {
    if (existing && !seeded) {
      setType(existing.type);
      setMakeModel(existing.makeModel ?? '');
      setPlate(existing.plate ?? '');
      setIsDefault(existing.isDefault ?? false);
      setSeeded(true);
      setDefaultSeeded(true);
    }
  }, [existing, seeded]);

  // On create, default to true when the customer has no vehicles yet.
  useEffect(() => {
    if (!vehicleId && !defaultSeeded && vehicles) {
      setIsDefault(vehicles.length === 0);
      setDefaultSeeded(true);
    }
  }, [vehicleId, defaultSeeded, vehicles]);

  const pickRcPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    const uri = result.assets[0].uri;
    if (vehicleId) {
      uploadRc.mutate({ vehicleId, localUri: uri });
    } else {
      setPendingRcUri(uri);
    }
  };

  const canSave = makeModel.trim().length > 0 && plate.trim().length > 0;

  // Awaits the RC upload instead of firing it and navigating away
  // immediately — a failed presigned PUT (dropped connection, expired
  // signature, backend's size cap) was previously invisible: the user saw
  // "vehicle saved" and had no way to know the photo never uploaded.
  const save = async () => {
    const data = { type, makeModel: makeModel.trim(), plate: plate.trim(), isDefault };
    try {
      if (vehicleId) {
        await updateVehicle.mutateAsync({ vehicleId, patch: data });
      } else {
        const created = await createVehicle.mutateAsync(data);
        if (pendingRcUri) {
          try {
            await uploadRc.mutateAsync({ vehicleId: created.id, localUri: pendingRcUri });
          } catch (e) {
            Alert.alert(
              'RC upload failed',
              e instanceof Error
                ? e.message
                : 'Your vehicle was saved, but the RC photo did not upload. Open the vehicle to try again.',
            );
          }
        }
      }
      navigation.goBack();
    } catch {
      Alert.alert('Could not save vehicle', 'Please try again.');
    }
  };
  const del = () => {
    if (vehicleId) deleteVehicle.mutate(vehicleId, { onSuccess: () => navigation.goBack() });
  };

  const saving = createVehicle.isPending || updateVehicle.isPending || uploadRc.isPending;
  const rcStatus = existing?.rcUrl
    ? 'RC uploaded'
    : uploadRc.isPending
      ? 'Uploading…'
      : pendingRcUri
        ? 'RC selected — uploads on save'
        : 'Upload RC (optional)';
  const rcDone = !!existing?.rcUrl || (!!pendingRcUri && !vehicleId);

  if (vehicleId && vehiclesPending) {
    return (
      <MiScreen edges={['top']}>
        <View style={{ paddingHorizontal: 21 }}>
          <MiNavBar title="Edit Vehicle" trailing="none" onBack={() => navigation.goBack()} />
        </View>
      </MiScreen>
    );
  }

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View style={{ paddingHorizontal: 21, paddingBottom: Math.max(insets.bottom, 43) }}>
          <MiButton
            tone="dark"
            label="Save Vehicle"
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
        </View>
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 21, gap: 16, paddingBottom: 24 }}
      >
        {/* 294:2920 — Nav bar */}
        <MiNavBar
          title={vehicleId ? 'Edit Vehicle' : 'Add Vehicle'}
          trailing="none"
          onBack={() => navigation.goBack()}
        />

        {/* 294:3078 — Vehicle Type */}
        <View style={{ gap: 12 }}>
          <MiText variant="medium16">Vehicle Type</MiText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map((t) => (
              <MiChip
                key={t.value}
                label={t.label}
                selected={type === t.value}
                onPress={() => setType(t.value)}
              />
            ))}
          </View>
        </View>

        {/* 294:3095 — Make & Model */}
        <MiTextField
          label="Make & Model"
          value={makeModel}
          onChangeText={setMakeModel}
          placeholder="Maruti Suzuki Swift"
          autoCapitalize="words"
        />

        {/* 294:3107 — Number Plate */}
        <MiTextField
          label="Number Plate"
          value={plate}
          onChangeText={setPlate}
          placeholder="KA 01 AB 1234"
          autoCapitalize="characters"
          autoCorrect={false}
        />

        {/* 294:3119 — RC upload */}
        <Pressable
          onPress={pickRcPhoto}
          disabled={uploadRc.isPending}
          pressScale={theme.motion.pressScale.row}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={rcStatus}
          style={{
            backgroundColor: mitowColors.surfaceMuted,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: rcDone ? mitowColors.successText : mitowColors.borderHandle,
            borderRadius: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12.5,
            paddingLeft: 12.5,
            paddingRight: 14.5,
          }}
        >
          <MiColorIcon name="upload" size={28} />
          <View style={{ flex: 1, gap: 2 }}>
            <MiText variant="strong15">{rcStatus}</MiText>
            <MiText variant="bodyS14" color="secondary">
              Photo or PDF of the registration certificate
            </MiText>
          </View>
        </Pressable>

        {/* 294:3124 — Default */}
        <MiMenuCard radius={16} paddingVertical={4}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 14,
              paddingRight: 10,
            }}
          >
            <View style={{ width: 34, height: 34 }}>
              <MiLineIcon name="star" size={34} color={mitowColors.brandYellow} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <MiText variant="bodyM15">Set as default vehicle</MiText>
              <MiText variant="bodyS14" color="secondary">
                Pre-selected when you book
              </MiText>
            </View>
            <Toggle value={isDefault} onValueChange={setIsDefault} />
          </View>
        </MiMenuCard>

        {/* Edit mode only — not drawn in Figma; kept so a vehicle can still be removed. */}
        {vehicleId ? (
          <MiButton
            tone="dangerSoft"
            label="Delete Vehicle"
            onPress={del}
            loading={deleteVehicle.isPending}
          />
        ) : null}
      </ScrollView>
    </MiScreen>
  );
}
