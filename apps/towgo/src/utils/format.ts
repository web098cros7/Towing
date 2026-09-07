/** "10 mins", "1 min". */
export const formatEta = (minutes: number): string => `${minutes} min${minutes === 1 ? '' : 's'}`;

/**
 * Money formatting lives in `@towing/api-contracts` since Phase 19.
 *
 * It was hand-rolled HERE and, separately, in TowPartner — and this copy was
 * wrong for negative amounts (`formatINR(-500)` produced `"₹-,500"`, because
 * the grouping branch tested a `rest` of `"-"`, which is truthy). Nothing
 * caught it because no screen rendered negative money until the wallet.
 * One implementation, one spec (`apps/backend/src/test/money-format.spec.ts`).
 */
export { formatPaise, formatRupees as formatINR } from '@towing/api-contracts';

/**
 * Shift a 12-hour clock label by N minutes, e.g. ("4:20 PM", 55) → "5:15 PM".
 *
 * Booking payloads carry a pickup label and a duration, not a drop timestamp,
 * so the details screen derives the arrival time rather than inventing a field.
 * Returns the input unchanged if it isn't a recognisable "h:mm AM/PM".
 */
export function addMinutesToTimeLabel(time: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!match) return time;

  const [, rawHour, rawMinute, meridiem] = match;
  const hour12 = Number(rawHour) % 12;
  const base = (meridiem.toUpperCase() === 'PM' ? hour12 + 12 : hour12) * 60 + Number(rawMinute);
  const shifted = ((base + minutes) % 1440 + 1440) % 1440;

  const hour24 = Math.floor(shifted / 60);
  const displayHour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const displayMinute = String(shifted % 60).padStart(2, '0');
  return `${displayHour}:${displayMinute} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * A short "how long ago" label for the notification centre, e.g. "12m", "3h",
 * "2d", then an absolute date past a week.
 *
 * Hand-rolled rather than `Intl.RelativeTimeFormat` for the same reason
 * `formatINR` is: Hermes' Intl support is unreliable across the RN versions
 * this app targets, and a formatter that silently returns the wrong string on
 * one engine is worse than a plain one that is the same everywhere.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const date = new Date(then);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * `2026-05-17T05:00:00Z` → `17 May 2026`.
 *
 * Added in Phase 15, when `Booking` stopped carrying pre-formatted `date` and
 * `time` strings. A server that hands out "17 May 2024" has already decided the
 * locale and the timezone for every client — formatting is the view's job.
 */
export function formatBookingDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** `2026-05-17T05:00:00Z` → `10:30 AM` in the operating timezone. */
export function formatBookingTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}
