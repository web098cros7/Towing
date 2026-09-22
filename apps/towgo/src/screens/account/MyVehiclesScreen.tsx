import React from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePressablePrimitive } from '@towing/ui';
import { ErrorState } from '@towing/ui';
import { useTheme } from '@towing/theme';
import type { VehicleCategory } from '@towing/api-contracts';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiButton,
  MiColorIcon,
  MiLineIcon,
  mitowColors,
  mitowLayout,
  mitowRadii,
  mitowShadows,
} from '@/design';
import { useVehicles } from '@/features/account/api/vehicles.queries';
import type { RootStackParamList } from '@/navigation/types';

const typeLabel: Record<VehicleCategory, string> = {
  hatchback: 'Hatchback',
  sedan: 'Sedan',
  suv: 'SUV',
  muv: 'MUV',
  luxury: 'Luxury',
  bike: 'Bike',
  other: 'Other',
};

/**
 * Figma 48 · My Vehicles (294:2869)
 * Figma 49 · My Vehicles · Empty (301:4703)
 */
export function MyVehiclesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const { data: vehicles, isPending, isError, refetch } = useVehicles();

  const hasVehicles = !!vehicles && vehicles.length > 0;
  const isEmpty = !!vehicles && vehicles.length === 0;

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
          {/* Figma 294:3065 — Add Vehicle */}
          <MiButton
            tone="dark"
            label="Add Vehicle"
            onPress={() => navigation.navigate('AddVehicle')}
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
      >
        <MiNavBar title="My Vehicles" trailing="none" onBack={() => navigation.goBack()} />

        {isError && !vehicles ? (
          <ErrorState title="Couldn't load your vehicles" onRetry={() => refetch()} />
        ) : isPending ? null : hasVehicles ? (
          <>
            {/* Figma 294:3036 — Vehicles */}
            <View style={{ gap: 12 }}>
              {vehicles!.map((v) => {
                const title = v.makeModel ?? typeLabel[v.type];
                const subtitle = [v.plate, typeLabel[v.type]].filter(Boolean).join(' · ');
                const a11y = `${title}, ${subtitle}${v.isDefault ? ', default vehicle' : ''}. Edit`;
                return (
                  <Pressable
                    key={v.id}
                    pressScale={theme.motion.pressScale.row}
                    haptic="light"
                    accessibilityRole="button"
                    accessibilityLabel={a11y}
                    onPress={() => navigation.navigate('AddVehicle', { vehicleId: v.id })}
                    style={{
                      backgroundColor: mitowColors.surfacePage,
                      borderWidth: 1.2,
                      borderColor: mitowColors.borderSubtle,
                      borderRadius: 16,
                      ...mitowShadows.card,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingTop: 10.8,
                      paddingBottom: 10.8,
                      paddingLeft: 10.8,
                      paddingRight: 12.8,
                    }}
                  >
                    {/* Figma 324:8895 — Vehicle thumb */}
                    <View
                      style={{
                        width: 88,
                        height: 64,
                        borderRadius: 12,
                        backgroundColor: mitowColors.surfaceMuted,
                        overflow: 'hidden',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {v.type === 'suv' || v.type === 'muv' ? (
                        <Image
                          source={require('@/assets/illustrations/vehicle-suv.png')}
                          style={{ width: 80, height: 58 }}
                          resizeMode="contain"
                        />
                      ) : v.type === 'bike' ? (
                        <MiColorIcon name="bike" size={48} />
                      ) : (
                        <Image
                          source={require('@/assets/illustrations/vehicle-hatchback.png')}
                          style={{ width: 80, height: 58 }}
                          resizeMode="contain"
                        />
                      )}
                    </View>

                    {/* Figma 294:3040 — Text */}
                    <View style={{ flex: 1, gap: 4 }}>
                      <MiText variant="strong16" numberOfLines={1}>
                        {title}
                      </MiText>
                      <MiText variant="bodyS14" color="secondary" numberOfLines={1}>
                        {subtitle}
                      </MiText>
                      {v.isDefault ? (
                        /* Figma 294:3043 — Default badge */
                        <View
                          style={{
                            alignSelf: 'flex-start',
                            backgroundColor: mitowColors.brandYellowSoft,
                            borderRadius: 6,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                        >
                          <MiText variant="label13" color="brand">
                            Default
                          </MiText>
                        </View>
                      ) : null}
                    </View>

                    <MiLineIcon name="chevron-right" size={20} />
                  </Pressable>
                );
              })}
            </View>

            {/* Figma 294:3055 — Book faster */}
            <View
              accessible
              accessibilityLabel="Book faster. Your default vehicle is pre-selected when you book a tow. Tap a vehicle to edit or remove it."
              style={{
                height: 104,
                borderRadius: 14,
                backgroundColor: mitowColors.surfaceMuted,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 8,
              }}
            >
              <View
                style={{
                  width: 49,
                  height: 49,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MiLineIcon name="star" size={49} color={mitowColors.brandYellow} />
              </View>
              <View style={{ flex: 1 }}>
                <MiText variant="strong155">Book faster</MiText>
                <MiText variant="bodyXS135" color="secondary">
                  Your default vehicle is pre-selected when you book a tow. Tap a vehicle to edit or
                  remove it.
                </MiText>
              </View>
            </View>
          </>
        ) : isEmpty ? (
          /* Figma 390:18386 — Add vehicle banner */
          <Pressable
            pressScale={theme.motion.pressScale.row}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel="Add your vehicle details for faster towing experience."
            onPress={() => navigation.navigate('AddVehicle')}
            style={{
              height: 90,
              borderRadius: 16,
              backgroundColor: '#FCF5E1',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <MiText
              variant="strong14"
              style={{
                position: 'absolute',
                left: 20.5,
                top: 22.5,
                width: 187,
                fontSize: 12.344,
                lineHeight: 19.75,
                letterSpacing: -0.2469,
              }}
            >
              Add your vehicle details for faster towing experience.
            </MiText>
            {/* Figma 388:18845 — ILL-11 */}
            <Image
              source={require('@/assets/illustrations/add-vehicle.png')}
              style={{ position: 'absolute', left: 204.5, top: 9.5, width: 143, height: 71 }}
              resizeMode="cover"
            />
          </Pressable>
        ) : null}
      </ScrollView>
    </MiScreen>
  );
}
