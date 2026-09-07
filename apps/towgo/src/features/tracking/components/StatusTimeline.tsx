import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text } from '@towing/ui';
import type { JobStatus } from '@towing/api-contracts';
import { Check } from '@/icons';

/**
 * §9.1.7's "status timeline (Searching → Assigned → En route → Arrived → In
 * progress → Completed)".
 *
 * SIX STEPS OUT OF §5.1's TEN STATES, and the four missing ones are missing on
 * purpose. `paid` is not a step of the tow — it happens after the customer has
 * put their phone away, and drawing it as an unreached stage would make every
 * completed trip look unfinished. `cancelled`, `no_drivers_found` and `disputed`
 * are not stages at all: they are places the journey ENDS, and a timeline that
 * rendered them as a seventh dot would imply the trip continues past them. The
 * screen shows those as a banner instead.
 *
 * The step set is derived from the status rather than stored, because §5.2 has a
 * backward edge — an unable-to-deliver puts a booking back to `searching` — and
 * a timeline holding its own "furthest reached" state would keep showing a
 * completed arrival for a driver who has been replaced.
 */

const STEPS: { status: JobStatus; label: string }[] = [
  { status: 'searching', label: 'Finding a driver' },
  { status: 'assigned', label: 'Driver assigned' },
  { status: 'en_route', label: 'On the way' },
  { status: 'arrived', label: 'Arrived at pickup' },
  { status: 'in_progress', label: 'Towing your vehicle' },
  { status: 'completed', label: 'Completed' },
];

/** How far along the timeline a status sits. `paid` counts as completed. */
function indexFor(status: JobStatus): number {
  if (status === 'paid') return STEPS.length - 1;
  const found = STEPS.findIndex((step) => step.status === status);
  // A terminal branch (`cancelled`, `no_drivers_found`, `disputed`) has no
  // position; the screen renders a banner instead of this component.
  return found;
}

export function StatusTimeline({ status }: { status: JobStatus }) {
  const theme = useTheme();
  const current = indexFor(status);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Trip progress: ${STEPS[Math.max(0, current)]?.label ?? 'Unknown'}`}
      style={{ gap: 0 }}
    >
      {STEPS.map((step, index) => {
        const done = current > index;
        const active = current === index;
        const last = index === STEPS.length - 1;

        const dotColor = done
          ? theme.colors.success
          : active
            ? theme.colors.brand
            : theme.colors.border;

        return (
          <View key={step.status} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center', width: 20 }}>
              <View
                style={{
                  width: active ? 14 : 12,
                  height: active ? 14 : 12,
                  borderRadius: 7,
                  backgroundColor: done || active ? dotColor : theme.colors.card,
                  borderWidth: done || active ? 0 : 2,
                  borderColor: theme.colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 4,
                }}
              >
                {done ? <Check size={8} color={theme.colors.card} strokeWidth={3} /> : null}
              </View>

              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: 18,
                    // The connector reads as "reached" only when the step BELOW
                    // it has been: a green line into an unreached dot is the
                    // classic way a timeline claims progress it does not have.
                    backgroundColor: done ? theme.colors.success : theme.colors.border,
                  }}
                />
              ) : null}
            </View>

            <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
              <Text
                weight={active ? 'semibold' : 'regular'}
                color={done || active ? 'primary' : 'tertiary'}
                style={{ fontSize: 14, lineHeight: 20 }}
              >
                {step.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** True when the status has a place on the timeline at all. */
export function hasTimelinePosition(status: JobStatus): boolean {
  return indexFor(status) >= 0;
}
