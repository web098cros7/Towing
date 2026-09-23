import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Screen, Text, Button, Card, ListRow, Skeleton, ErrorState } from '@towing/ui';
import { ApiClientError } from '@/lib/api/errors';
import { DriverHeader } from '@/components/DriverHeader';
import { Toggle } from '@/components/Toggle';
import { RefreshCw, Route } from '@/icons';
import { useTabBarSpace } from '@/navigation/DriverTabBar';
import {
  useCapabilities,
  useUpdateCapabilities,
} from '@/features/capabilities/api/capabilities.queries';
import {
  SERVICE_OPTIONS,
  VEHICLE_CLASS_OPTIONS,
  type OptionalServiceType,
  type VehicleClass,
} from '@/features/capabilities/types';
import type { RootStackParamList } from '@/navigation/types';

/**
 * Replaces the `MyVehicles` placeholder. Opens on the driver's current
 * settings, fetched from `GET /driver/capabilities`.
 */
export function CapabilitiesScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabBarSpace = useTabBarSpace();
  const { data, isPending, isError, refetch } = useCapabilities();
  const [vehicleClass, setVehicleClass] = useState<VehicleClass | null>(null);
  const [longDistanceEnabled, setLongDistanceEnabled] = useState(false);
  const [services, setServices] = useState<OptionalServiceType[]>([]);
  const [dirty, setDirty] = useState(false);
  const update = useUpdateCapabilities();

  // Seed from the query only while the driver has not edited anything, so a
  // refetch never overwrites a half-made choice.
  useEffect(() => {
    if (!data || dirty) return;
    setVehicleClass(data.vehicleClass);
    setLongDistanceEnabled(data.longDistanceEnabled);
    setServices(data.services);
  }, [data, dirty]);

  const toggleService = (value: OptionalServiceType) => {
    setServices((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
    setDirty(true);
  };

  const onSave = async () => {
    if (!vehicleClass) return;
    try {
      const result = await update.mutateAsync({
        vehicleClass,
        // Only flatbeds do long-haul (spec) — never send the flag true for a
        // wheel-lift pick, even if it was left on from a prior selection.
        longDistanceEnabled: vehicleClass === 'flatbed' ? longDistanceEnabled : false,
        // Always sent, including when empty: [] is the real answer for a driver
        // who only tows, and omitting the key would mean "leave it alone" — so
        // unticking the last service would appear to save and quietly not.
        services,
      });
      setVehicleClass(result.vehicleClass);
      setLongDistanceEnabled(result.longDistanceEnabled);
      setServices(result.services);
      setDirty(false);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 403) {
        const reason = (error.details as { reason?: string } | undefined)?.reason;
        if (reason === 'kyc_not_approved') {
          Alert.alert(
            'Verification required',
            'Your KYC approval is no longer active. Please check your verification status.',
            [{ text: 'OK', onPress: () => navigation.navigate('KycStatus') }],
          );
          return;
        }
      }
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Something went wrong.');
    }
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: tabBarSpace }}>
      <DriverHeader leading="back" title="Capabilities" titleSize={22} showBell={false} onLeading={() => navigation.goBack()} />

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        {isPending ? (
          <View style={{ gap: 12 }}>
            <Skeleton width="100%" height={120} radius={20} />
            <Skeleton width="100%" height={80} radius={20} />
          </View>
        ) : isError ? (
          <ErrorState
            title="Couldn't load your settings"
            onRetry={() => refetch()}
            icon={RefreshCw}
          />
        ) : (
          <>
        <View style={{ gap: 10 }}>
          <Text weight="semibold" style={{ fontSize: 15 }}>
            Vehicle class
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {VEHICLE_CLASS_OPTIONS.map((option) => {
              const selected = vehicleClass === option.value;
              return (
                <Card
                  key={option.value}
                  onPress={() => {
                    setVehicleClass(option.value);
                    setDirty(true);
                  }}
                  style={{
                    flex: 1,
                    borderColor: selected ? theme.colors.brand : theme.colors.borderSubtle,
                    borderWidth: selected ? 2 : 1,
                  }}
                  accessibilityLabel={option.label}
                >
                  <Text weight={selected ? 'semibold' : 'regular'} align="center">
                    {option.label}
                  </Text>
                </Card>
              );
            })}
          </View>
        </View>

        {vehicleClass === 'flatbed' ? (
          <ListRow
            leading={<Route size={20} color={theme.colors.textPrimary} />}
            title="Long-distance jobs"
            subtitle="Get offered long-haul tows outside your city"
            trailing={
              <Toggle
                value={longDistanceEnabled}
                onValueChange={(value) => {
                  setLongDistanceEnabled(value);
                  setDirty(true);
                }}
              />
            }
          />
        ) : null}

        <View style={{ gap: 10 }}>
          <Text weight="semibold" style={{ fontSize: 15 }}>
            Roadside services
          </Text>
          <Text color="secondary" style={{ fontSize: 12, lineHeight: 17 }}>
            Tick only what you can actually do — you'll be offered these jobs
            alongside tows. Leave them all off if you only tow.
          </Text>
          <View style={{ gap: 8 }}>
            {SERVICE_OPTIONS.map((option) => (
              <ListRow
                key={option.value}
                title={option.label}
                subtitle={option.kit}
                trailing={
                  <Toggle
                    value={services.includes(option.value)}
                    onValueChange={() => toggleService(option.value)}
                  />
                }
              />
            ))}
          </View>
        </View>

        {update.isError && !(update.error instanceof ApiClientError && update.error.status === 403) ? (
          <Text color="error" style={{ fontSize: 13 }}>
            {update.error instanceof Error ? update.error.message : 'Could not save — try again.'}
          </Text>
        ) : null}

        <Button
          label="Save"
          fullWidth
          disabled={!vehicleClass || update.isPending}
          loading={update.isPending}
          onPress={onSave}
        />
          </>
        )}
      </View>
    </Screen>
  );
}
