import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Text } from '@towing/ui';
import { ChevronRight } from '@/icons';
import { useCurrentJob } from '@/features/offers/api/offers.queries';
import { SERVICE_ICON, serviceLabel } from '@/features/offers/serviceLabels';
import { JOB_STATUS_META } from '@/features/jobs/statusMeta';
import { driverColors } from '@/theme/driverColors';
import type { RootStackParamList } from '@/navigation/types';
import { Pressable } from '@/motion';

/**
 * The way back to a job the driver is still holding.
 *
 * WITHOUT THIS, A DRIVER WHO LEAVES THE JOB SCREEN HAS NO ROUTE BACK TO IT.
 * The job screen is reached from the accept flow and from a push tap; once the
 * driver taps back to the tabs — to check earnings, to read a message — the
 * only way to find the job again was to remember it existed and hope a push
 * arrived. That is fine for a driver who never leaves the screen and useless
 * for one who does, which is every driver.
 *
 * Rendered on the home screen, directly under the online toggle, because that
 * is where a driver looks when they are deciding what to do next.
 *
 * TWO CASES, ONE BANNER. An ACTIVE job (assigned/en_route/arrived/in_progress)
 * is "you're on a job". A COMPLETED or PAID job whose payment has not settled
 * is "finish your last job" — the driver still has something to do (collect,
 * confirm), and the job screen is where they do it. A completed job whose
 * payment IS settled is done, and the banner stays out of the way.
 */
export function ActiveJobBanner() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: job } = useCurrentJob();

  if (!job) return null;

  const isActive =
    job.status === 'assigned' ||
    job.status === 'en_route' ||
    job.status === 'arrived' ||
    job.status === 'in_progress';

  const isUnpaidFinished =
    (job.status === 'completed' || job.status === 'paid') && job.payment.status !== 'paid';

  if (!isActive && !isUnpaidFinished) return null;

  const Icon = SERVICE_ICON[job.serviceType];
  const title = isUnpaidFinished ? 'Finish your last job' : "You're on a job";

  return (
    <Pressable
      onPress={() => navigation.navigate('AssignedJob')}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={title}
      style={() => ({})}
    >
      <Card
        padding={16}
        style={{
          borderRadius: 20,
          backgroundColor: driverColors.chip.green.bg,
          borderColor: driverColors.online,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon size={22} color={driverColors.online} strokeWidth={2.2} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium" style={{ fontSize: 16, lineHeight: 22 }}>
              {title}
            </Text>
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
              {serviceLabel(job)} · {JOB_STATUS_META[job.status].label}
            </Text>
          </View>
          <ChevronRight size={20} color={driverColors.chevron} strokeWidth={2.2} />
        </View>
      </Card>
    </Pressable>
  );
}
