/**
 * Display formatters for Figma 11 / 12, matching the drawn formats exactly.
 * Hand-rolled rather than `Intl`, because Hermes and Node disagree on the case
 * of "am"/"pm" and on the order of weekday/day/month.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `11:15 AM`, `1:15 PM`, `8:00 PM` — h:mm, no leading zero, uppercase meridiem. */
export function formatClock(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** `Thu, 13 Mar` — short weekday, comma, day, short month, no year. */
export function formatShortDay(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** The ten national digits of an Indian mobile, from any of `+91…`, `91…`, `0…` or bare digits. */
export function nationalDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** `+91 98765 43210` — country code, then 5 + 5. Partial input keeps the grouping. */
export function formatIndianMobile(digits: string): string {
  if (!digits) return '';
  const head = digits.slice(0, 5);
  const tail = digits.slice(5, 10);
  return tail ? `+91 ${head} ${tail}` : `+91 ${head}`;
}

/** Display string for a stored mobile (`+919876543210` → `+91 98765 43210`). */
export function displayMobile(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = nationalDigits(raw);
  return digits.length === 10 ? formatIndianMobile(digits) : raw;
}
