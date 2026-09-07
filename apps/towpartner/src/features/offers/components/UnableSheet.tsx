import React, { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import type { JobUnableReason } from '@towing/api-contracts';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';
import { Pressable } from '@/motion';

/**
 * §9.2.3's "unable-to-deliver (customer unavailable / wrong address / refused)".
 *
 * A CLOSED LIST, NOT FREE TEXT, and that is a decision about ops rather than
 * about UI. This branch has three consequences — the customer is never charged
 * (§3.5), the driver's `completion_rate` moves, and §6.5 re-dispatches — so the
 * reason is a number somebody will want to aggregate. Free text makes "customer
 * unavailable" and "cust not there" different reasons forever, and there is no
 * way back once a year of it exists. The optional note carries the colour.
 *
 * THE COPY MATTERS MORE THAN USUAL. A driver reads this while standing beside a
 * vehicle they cannot move, often after twenty minutes of waiting, and the
 * reason they pick decides whether their own completion rate takes the hit. So
 * each option says what it means rather than naming an enum, and the sheet says
 * plainly that the customer is not charged — because a driver who thinks they
 * are costing somebody money is a driver who picks the wrong option.
 */

const REASONS: { value: JobUnableReason; label: string; detail: string }[] = [
  {
    value: 'customer_unavailable',
    label: 'Customer not reachable',
    detail: 'They are not at the pickup and are not answering.',
  },
  {
    value: 'wrong_address',
    label: 'Wrong address',
    detail: 'The vehicle is not where the booking says it is.',
  },
  {
    value: 'customer_refused',
    label: 'Customer declined the tow',
    detail: 'They changed their mind after you arrived.',
  },
  {
    value: 'vehicle_inaccessible',
    label: 'Cannot reach the vehicle',
    detail: 'Basement, locked yard, blocked in, or no clearance.',
  },
  {
    value: 'unsafe_conditions',
    label: 'Unsafe to proceed',
    detail: 'Traffic, weather, or the site is not safe to work in.',
  },
  {
    value: 'breakdown',
    label: 'My truck has a problem',
    detail: 'You cannot complete this job with this vehicle.',
  },
];

export function UnableSheet({
  visible,
  onDismiss,
  onConfirm,
  isPending,
}: {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: (reason: JobUnableReason, note?: string) => void;
  isPending: boolean;
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState<JobUnableReason | null>(null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <View
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 24,
            paddingBottom: 32,
            maxHeight: '85%',
          }}
        >
          <View style={{ paddingHorizontal: 24, gap: 6, paddingBottom: 12 }}>
            <Text weight="semibold" style={{ fontSize: 18, lineHeight: 24 }}>
              Unable to deliver
            </Text>
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 19 }}>
              We will look for another driver and the customer will not be charged. Tell us what
              happened so we can help them faster.
            </Text>
          </View>

          <ScrollView style={{ paddingHorizontal: 24 }} contentContainerStyle={{ gap: 8 }}>
            {REASONS.map((reason) => {
              const active = selected === reason.value;
              return (
                <Pressable
                  key={reason.value}
                  onPress={() => setSelected(reason.value)}
                  haptic="selection"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={reason.label}
                  style={() => ({
                    borderRadius: 14,
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? theme.colors.brand : theme.colors.border,
                    padding: 14,
                    gap: 2,
                  })}
                >
                  <Text weight="medium" style={{ fontSize: 14, lineHeight: 20 }}>
                    {reason.label}
                  </Text>
                  <Text color="secondary" style={{ fontSize: 12, lineHeight: 17 }}>
                    {reason.detail}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ paddingHorizontal: 24, paddingTop: 16, gap: 10 }}>
            <Button
              variant="destructive"
              label={isPending ? 'Sending…' : 'End this job'}
              onPress={() => selected && onConfirm(selected)}
              disabled={!selected || isPending}
              fullWidth
              accessibilityLabel="Confirm unable to deliver"
            />
            <Button
              variant="ghost"
              label="Go back"
              onPress={onDismiss}
              fullWidth
              accessibilityLabel="Go back to the job"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
