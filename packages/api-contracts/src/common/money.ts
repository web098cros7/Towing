import { z } from 'zod';

/**
 * Money crosses the API as integer paise (precision-safe in JSON); the
 * database stores NUMERIC(12,2) rupee strings. These two converters are the
 * only sanctioned bridge — both work in string/integer space so no float ever
 * touches a money value.
 */

/** Integer paise. Signed — ledger amounts carry their sign. */
export const paiseSchema = z.number().int();

/** Non-negative paise for fares/balances where a sign would be a bug. */
export const unsignedPaiseSchema = z.number().int().min(0);

/** `"149.90"` → `14990`. Accepts optional sign and 0–2 decimal places. */
export function rupeeStringToPaise(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Not a NUMERIC(12,2) rupee string: "${value}"`);
  }
  const [, sign, whole, fraction = ''] = match;
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign === '-' ? -paise : paise;
}

/** `14990` → `"149.90"` (round-trips with rupeeStringToPaise). */
export function paiseToRupeeString(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`Not an integer paise amount: ${paise}`);
  }
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Indian-grouped rupees from integer paise, e.g. `125000` → `"₹1,250"`,
 * `10000000` → `"₹1,00,000"`, `-50000` → `"-₹500"`.
 *
 * HERE RATHER THAN IN EACH APP, because until Phase 19 there were two
 * hand-rolled copies — one per mobile app — and one of them was WRONG. TowGo's
 * grouped the signed string directly, so `-500` produced `"₹-,500"`: `last3`
 * was `"500"` and `rest` was `"-"`, which is truthy, so the grouping branch
 * ran. It had never mattered because nothing rendered negative money — and
 * then Phase 19 shipped a wallet where payout debits, cancellation
 * compensation and §14.5 reversals are all negative rows.
 *
 * HAND-ROLLED, NOT `Intl`: Hermes' `Intl`/`toLocaleString` support is unreliable
 * across the React Native versions these apps target, and a formatter that
 * silently returns the wrong string on one engine is worse than a plain one
 * that behaves identically everywhere.
 *
 * (`apps/towfleet-web/src/lib/money.ts` keeps its own `Intl`-based version. A
 * browser's `Intl` is correct and well-tested, so there is nothing to gain by
 * moving it here — the duplication this replaces was between the two apps that
 * shared an engine and a bug.)
 */
export function formatPaise(paise: number): string {
  if (paise % 100 === 0) return formatRupees(paise / 100);

  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}${formatRupees(whole)}.${cents}`;
}

/**
 * Whole rupees, Indian-grouped. Exported for axis labels and other places that
 * want the number without a currency symbol — strip the ₹ rather than
 * reimplementing the grouping.
 *
 * THE SIGN IS EXTRACTED BEFORE GROUPING. That is the whole fix.
 */
export function formatRupees(amount: number): string {
  const rounded = Math.round(amount);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}₹${grouped}`;
}
