import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Text } from '@towing/ui';
import { ChevronRight, Wrench } from '@/icons';
import { useCapabilities } from '@/features/capabilities/api/capabilities.queries';
import { driverColors } from '@/theme/driverColors';
import type { RootStackParamList } from '@/navigation/types';
import { Pressable } from '@/motion';

/**
 * The onboarding step a newly approved driver would otherwise never find.
 *
 * APPROVAL IS NOT THE END OF SETUP, AND NOTHING SAID SO. A driver came out of
 * the KYC wizard with `vehicle_class` still null and landed on a dashboard with
 * a working online toggle — so they went online, and dispatch skipped them on
 * every job, because the class filter excludes a null class from every tow. The
 * screen that fixes it was three taps into Profile and nothing pointed at it.
 * Now that the roadside services are the driver's own answer too, the same
 * silence would cost them five job types instead of one.
 *
 * Shown ONLY until the driver has saved a vehicle class once. Services are
 * deliberately not part of the condition: an empty roadside set is a real
 * answer — a driver who only tows — and a banner that stayed up until they
 * ticked something would be nagging them to claim kit they may not carry. One
 * trip through the form puts both questions in front of them, which is the
 * point of sending them there.
 *
 * Sits under the online toggle for the reason `ActiveJobBanner` does: it is
 * where a driver looks when deciding what to do next.
 */
export function SetUpCapabilitiesBanner() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data } = useCapabilities();

  // No data yet says nothing — a banner that flashed in on every cold start and
  // out again a moment later would read as an error, not a prompt.
  if (!data || data.vehicleClass !== null) return null;

  return (
    <Pressable
      onPress={() => navigation.navigate('Capabilities')}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel="Finish setting up your truck and services"
      style={() => ({})}
    >
      <Card
        padding={16}
        style={{
          borderRadius: 20,
          backgroundColor: driverColors.chip.gold.bg,
          borderColor: driverColors.chip.gold.fg,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Wrench size={22} color={driverColors.chip.gold.fg} strokeWidth={2.2} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium" style={{ fontSize: 16, lineHeight: 22 }}>
              Finish setting up
            </Text>
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
              Pick your truck class and the roadside jobs you can do — you won&apos;t
              be offered work until you do.
            </Text>
          </View>
          <ChevronRight size={20} color={driverColors.chevron} strokeWidth={2.2} />
        </View>
      </Card>
    </Pressable>
  );
}
