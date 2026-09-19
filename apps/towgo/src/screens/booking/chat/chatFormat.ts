import type { ChatMessage } from '@/features/chat/types';
import { clockLabel } from '@/screens/booking/tracking/trackingDisplay';

/**
 * Figma 22's bubble time, "10:08 AM": 12-hour, no leading zero on the hour, a
 * NORMAL space (U+0020) before the upper-case meridiem, device-local. It is the
 * tracking screens' own `clockLabel` (formatted by hand: ICU would put a narrow
 * no-break space before "AM"). Only the 12-hour form is drawn; whether a phone
 * set to 24-hour time should follow the phone is open (22 spec, Data gap 7).
 */
export function messageTime(message: ChatMessage): string {
  const at = Date.parse(message.sentAt);
  return Number.isNaN(at) ? '' : clockLabel(at);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * The Day pill label. Figma draws only "Today". Any other day gets a short date
 * ("18 Sep", with the year when it is not this year), which is NOT drawn
 * (22 spec, Data gap 8): no "Yesterday", no weekday.
 */
export function dayLabel(date: Date, now: Date): string {
  if (sameLocalDay(date, now)) return 'Today';
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

export type ChatRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage };

/**
 * The list as drawn: one Day pill before the first message of each local calendar
 * day, then the bubbles. Messages keep their order (insertion order, never
 * re-sorted), so a pill is added whenever the day differs from the previous one.
 */
export function chatRows(messages: readonly ChatMessage[], now: Date): ChatRow[] {
  const rows: ChatRow[] = [];
  let previousDay: Date | null = null;

  for (const message of messages) {
    const sent = new Date(message.sentAt);
    const key = message.localId ?? message.id;
    if (!previousDay || !sameLocalDay(sent, previousDay)) {
      rows.push({ kind: 'day', key: `day-${key}`, label: dayLabel(sent, now) });
    }
    rows.push({ kind: 'message', key, message });
    previousDay = sent;
  }

  return rows;
}
