import React from 'react';
import { View } from 'react-native';
import type { DriverJob } from '@towing/api-contracts';
import { Card, Text } from '@towing/ui';
import { Clock } from '@/icons';
import { driverColors } from '@/theme/driverColors';
import { formatPaise } from '@/utils/format';
import { useWaitingCharge } from '../hooks/useWaitingCharge';

const INK_SOFT = '#4B5563';

/**
 * §7.4's waiting charge while it is still accruing — §9.2.3's "live waiting-charge
 * ticker".
 *
 * WHY SHOW IT TO THE DRIVER AT ALL, given the customer pays it. Two reasons, and
 * the second is the one that matters at a kerbside:
 *
 *  1. It is the only visible consequence of a decision they are making minute by
 *     minute — whether to keep waiting or to call unable-to-deliver. A driver who
 *     cannot see the meter has no basis for that call.
 *  2. It ends the "why is my fare higher than the quote" conversation before it
 *     starts. The number the driver watched accrue is the number the customer is
 *     billed, because both come from `arrivedAt` and the rules locked on the
 *     booking — not from two calculations that happen to agree.
 *
 * IT SAYS "FREE FOR ANOTHER N MINUTES" BEFORE IT SAYS A RUPEE FIGURE. Fifteen
 * minutes of a tow are free (§7.4), and a card that showed ₹0 for a quarter of an
 * hour would read as broken. Counting the free window down is both true and the
 * more useful thing to know.
 */
export function WaitingChargeCard({ job }: { job: DriverJob }) {
  const waiting = useWaitingCharge(job);

  // Nothing to show before arrival, and nothing to keep showing once the trip is
  // under way — `useWaitingCharge` freezes at `startedAt`, and a settled figure
  // belongs on the completion summary rather than in a live ticker.
  if (!waiting || job.status !== 'arrived') return null;

  return (
    <Card
      padding={16}
      style={{
        borderRadius: 20,
        borderColor: '#E5E7EB',
        backgroundColor: waiting.charging ? driverColors.noticeBg : undefined,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Clock
          size={16}
          color={waiting.charging ? driverColors.amber : INK_SOFT}
          strokeWidth={2.2}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, lineHeight: 20 }}>
            Waiting {waiting.waitedMinutes} min
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: INK_SOFT }}>
            {waiting.charging
              ? `${waiting.billableMinutes} min charged at ${formatPaise(job.waiting.perMinutePaise)}/min`
              : `Free for another ${waiting.freeRemainingMinutes} min`}
          </Text>
        </View>

        {waiting.charging ? (
          <Text
            weight="bold"
            tabular
            accessibilityLabel={`Waiting charge so far ${formatPaise(waiting.accruedPaise)}`}
            style={{ fontSize: 20, lineHeight: 26, color: driverColors.amber }}
          >
            {formatPaise(waiting.accruedPaise)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
