import type { CouponValidationDto } from '@towing/api-contracts';
import type { BookingDetail } from '@/features/bookings/types';
import { formatPaise } from '@/utils/format';
import type { PaymentBillLine } from './PaymentReview';

/**
 * The lines of Figma 28 · Payment · Details Open's Bill `490:18162`.
 *
 * Figma draws Base fare, "Distance charge (8.2 km)", Night charge and "Discount (TOW100)".
 *
 * Rules:
 * - Base fare: always; `booking.breakdown.basePaise`; slotWidth 37.
 * - Distance charge: always drawn, but the fare formula has no distance term: distance picks the
 *   slab, so it is already inside the base fare (`packages/api-contracts` `fareBreakdownSchema`).
 *   So its value is ALWAYS null (a placeholder bar; data gap for the owner). Label
 *   `Distance charge (${km} km)` when `booking.distanceKm` is a number (km =
 *   `String(Math.round(distanceKm * 10) / 10)`), else `Distance charge`; slotWidth 38.
 * - Night charge: only when `nightPaise > 0`; slotWidth 35.
 * - Add-ons the design does not draw, each only when > 0, in this order: `highwayPaise`
 *   "Highway pickup", `accidentPaise` "Accident recovery", `surgePaise` "Surge charge". Shown so
 *   the bill always adds up to its Total.
 * - Discount already on the booking (a coupon applied at confirm): when
 *   `breakdown.discountPaise > 0`, label "Discount", value `'−' + formatPaise(discountPaise)`,
 *   tone 'discount'. When `options.couponInBooking` is true (live mode, the server folded the
 *   coupon into the booking's discount), the label is `Discount (${coupon.code})` if a coupon is
 *   applied, and the separate coupon line is NOT added.
 * - Discount from the coupon applied on 27 (the `coupon` argument): when `coupon` is non-null and
 *   `coupon.discountPaise > 0` and `options.couponInBooking` is not true: label
 *   `coupon.code ? `Discount (${coupon.code})` : 'Discount'`, value
 *   `'−' + formatPaise(coupon.discountPaise)`, tone 'discount', slotWidth 45.
 * - Wallet credit: when `options.walletAppliedPaise > 0`, a last line
 *   `{ key: 'wallet', label: 'Wallet credit', value: MINUS + formatPaise(walletAppliedPaise),
 *   tone: 'discount' }`.
 * - The minus is U+2212 (as Figma draws "−₹100"), never a hyphen.
 * - While `booking` is undefined: return just Base fare with value null.
 * - No Distance charge line: distance is inside the base fare, whose label names the km.
 * - keys: 'base', 'distance', 'night', 'highway', 'accident', 'surge', 'booking-discount',
 *   'coupon-discount', 'wallet'.
 *
 * Pure: no side effects, no reads outside its arguments.
 */
export function buildPaymentBill(
  booking: BookingDetail | undefined,
  coupon: CouponValidationDto | null,
  options?: { couponInBooking?: boolean; walletAppliedPaise?: number },
): PaymentBillLine[] {
  // U+2212 MINUS SIGN, as Figma draws "−₹100" (never a hyphen).
  const MINUS = '\u2212';

  if (!booking) {
    // Booking still loading: the base line with a placeholder bar.
    return [{ key: 'base', label: 'Base fare', value: null, slotWidth: 37 }];
  }

  const { breakdown } = booking;
  const lines: PaymentBillLine[] = [];

  // Base fare, naming the distance it covers: the fare formula has no distance term (distance
  // picks the slab, so it is already inside the base fare), so there is no separate distance
  // line — an always-empty one read as unfinished (owner, 25 Sep 2026).
  lines.push({
    key: 'base',
    label:
      typeof booking.distanceKm === 'number'
        ? `Base fare (${String(Math.round(booking.distanceKm * 10) / 10)} km)`
        : 'Base fare',
    value: formatPaise(breakdown.basePaise),
    slotWidth: 37,
  });

  // Night charge: only when it is actually charged.
  if (breakdown.nightPaise > 0) {
    lines.push({
      key: 'night',
      label: 'Night charge',
      value: formatPaise(breakdown.nightPaise),
      slotWidth: 35,
    });
  }

  // Add-ons the design does not draw, each only when > 0, in this order. Shown so the bill
  // always adds up to its Total.
  if (breakdown.highwayPaise > 0) {
    lines.push({
      key: 'highway',
      label: 'Highway pickup',
      value: formatPaise(breakdown.highwayPaise),
    });
  }
  if (breakdown.accidentPaise > 0) {
    lines.push({
      key: 'accident',
      label: 'Accident recovery',
      value: formatPaise(breakdown.accidentPaise),
    });
  }
  if (breakdown.surgePaise > 0) {
    lines.push({
      key: 'surge',
      label: 'Surge charge',
      value: formatPaise(breakdown.surgePaise),
    });
  }

  // Discount already on the booking (a coupon applied at confirm). In live mode the server folds
  // the coupon into this line, so it is labelled with the coupon's code.
  if (breakdown.discountPaise > 0) {
    lines.push({
      key: 'booking-discount',
      label: options?.couponInBooking && coupon?.code ? `Discount (${coupon.code})` : 'Discount',
      value: MINUS + formatPaise(breakdown.discountPaise),
      tone: 'discount',
    });
  }

  // Discount from the coupon applied on 27 (the `coupon` argument). Skipped when the server
  // already folded the coupon into the booking's discount.
  if (!options?.couponInBooking && coupon && coupon.discountPaise > 0) {
    lines.push({
      key: 'coupon-discount',
      label: coupon.code ? `Discount (${coupon.code})` : 'Discount',
      value: MINUS + formatPaise(coupon.discountPaise),
      tone: 'discount',
      slotWidth: 45,
    });
  }

  // Wallet credit: the wallet covered part (or all) of the bill.
  if (options?.walletAppliedPaise && options.walletAppliedPaise > 0) {
    lines.push({
      key: 'wallet',
      label: 'Wallet credit',
      value: MINUS + formatPaise(options.walletAppliedPaise),
      tone: 'discount',
    });
  }

  return lines;
}
