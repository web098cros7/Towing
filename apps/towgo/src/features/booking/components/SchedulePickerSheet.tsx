import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { MiButton, MiColorIcon, MiOptionRow, MiSheet, MiText } from '@/design';
import { formatClock, formatShortDay } from './enter-location/format';

/**
 * Figma 11 · Schedule a Tow (sheet 289:2465), opened by the "Pickup now" pill.
 *
 * Five preset rows, always drawn: Now, In 1 hour, In 3 hours, Tonight 8:00 PM,
 * Tomorrow 9:00 AM. Tapping a row only moves the selection; "Done" commits it
 * to the booking store (`scheduledAt`, null = now) and closes. One row is
 * always selected, as drawn.
 */
type OptionKey = 'now' | 'in1h' | 'in3h' | 'tonight' | 'tomorrow';

interface Option {
  key: OptionKey;
  title: string;
  subtitle: string;
  at: Date | null;
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function relative(now: Date, hours: number): { at: Date; subtitle: string } {
  const at = new Date(now.getTime() + hours * 3_600_000);
  // "today" is the drawn wording; after midnight it would be false, so the
  // late-night case says "tomorrow" (the design does not draw that case).
  return { at, subtitle: `Around ${formatClock(at)} ${isSameDay(at, now) ? 'today' : 'tomorrow'}` };
}

function buildOptions(now: Date): Option[] {
  const in1h = relative(now, 1);
  const in3h = relative(now, 3);

  // 8:00 PM today; once that has passed the row moves to the next 8:00 PM (the
  // design does not say what replaces "Tonight").
  const evening = new Date(now);
  evening.setHours(20, 0, 0, 0);
  const eveningToday = evening.getTime() > now.getTime() + 60_000;
  if (!eveningToday) evening.setDate(evening.getDate() + 1);

  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);

  const tonight: Option = {
    key: 'tonight',
    title: `${eveningToday ? 'Tonight' : 'Tomorrow'}, ${formatClock(evening)}`,
    subtitle: eveningToday ? 'Today' : formatShortDay(evening),
    at: evening,
  };
  const tomorrow: Option = {
    key: 'tomorrow',
    title: `Tomorrow, ${formatClock(tomorrowMorning)}`,
    subtitle: formatShortDay(tomorrowMorning),
    at: tomorrowMorning,
  };

  return [
    { key: 'now', title: 'Now', subtitle: 'Nearest available tow truck', at: null },
    { key: 'in1h', title: 'In 1 hour', subtitle: in1h.subtitle, at: in1h.at },
    { key: 'in3h', title: 'In 3 hours', subtitle: in3h.subtitle, at: in3h.at },
    // Drawn order: the evening, then tomorrow morning. After 8:00 PM the evening
    // row is tomorrow's 8:00 PM, so the two swap to stay in time order.
    ...(eveningToday ? [tonight, tomorrow] : [tomorrow, tonight]),
  ];
}

/**
 * Which row a stored instant selects. An exact fixed preset wins; otherwise the
 * preset nearest in time (the relative presets drift between opens). A time
 * that has already passed reads as Now.
 */
function keyFor(scheduledAt: string | null, options: Option[], now: Date): OptionKey {
  if (!scheduledAt) return 'now';
  const at = new Date(scheduledAt).getTime();
  if (Number.isNaN(at) || at <= now.getTime()) return 'now';
  const fixed = options.find(
    (o) => (o.key === 'tonight' || o.key === 'tomorrow') && o.at?.getTime() === at,
  );
  if (fixed) return fixed.key;
  let best: { key: OptionKey; diff: number } = { key: 'now', diff: Infinity };
  for (const o of options) {
    const diff = Math.abs((o.at ?? now).getTime() - at);
    if (diff < best.diff) best = { key: o.key, diff };
  }
  return best.key;
}

export function SchedulePickerSheet({
  visible,
  scheduledAt,
  onSelect,
  onClose,
}: {
  visible: boolean;
  scheduledAt: string | null;
  onSelect: (iso: string | null) => void;
  onClose: () => void;
}) {
  // Rebuilt on each open so the relative presets are measured from that moment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [visible]);
  const options = useMemo(() => buildOptions(now), [now]);

  const [draft, setDraft] = useState<OptionKey>(() => keyFor(scheduledAt, options, now));

  useEffect(() => {
    if (visible) setDraft(keyFor(scheduledAt, options, now));
  }, [visible, scheduledAt, options, now]);

  const commit = () => {
    const chosen = options.find((o) => o.key === draft);
    if (chosen) onSelect(chosen.at ? chosen.at.toISOString() : null);
    onClose();
  };

  return (
    <MiSheet
      visible={visible}
      onClose={onClose}
      scrollable
      accessibilityLabel="When do you need the tow?"
    >
      <View style={{ gap: 4 }}>
        <MiText variant="title23">When do you need the tow?</MiText>
        <MiText variant="bodyM15" color="secondary">
          Pick a time and we will dispatch a truck then.
        </MiText>
      </View>

      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        {options.map((option) => (
          <MiOptionRow
            key={option.key}
            title={option.title}
            subtitle={option.subtitle}
            selected={option.key === draft}
            onPress={() => setDraft(option.key)}
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <MiColorIcon name="info" size={20} />
        <MiText variant="bodyS14" color="secondary" style={{ flex: 1 }}>
          A scheduled tow is confirmed now and dispatched at the time you pick.
        </MiText>
      </View>

      <MiButton label="Done" onPress={commit} />
    </MiSheet>
  );
}
