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
 *   tone 'discount'.
 * - Discount from the coupon applied on 27 (the `coupon` argument): when `coupon` is non-null and
 *   `coupon.discountPaise > 0`: label `coupon.code ? `Discount (${coupon.code})` : 'Discount'`,
 *   value `'−' + formatPaise(coupon.discountPaise)`, tone 'discount', slotWidth 45.
 * - The minus is U+2212 (as Figma draws "−₹100"), never a hyphen.
 * - While `booking` is undefined: return just Base fare and Distance charge, both with value null
 *   (label "Distance charge").
 * - keys: 'base', 'distance', 'night', 'highway', 'accident', 'surge', 'booking-discount',
 *   'coupon-discount'.
 *
 * Pure: no side effects, no reads outside its arguments.
 */
export function buildPaymentBill(
  booking: BookingDetail | undefined,
  coupon: CouponValidationDto | null,
): PaymentBillLine[] {
  // U+2212 MINUS SIGN, as Figma draws "−₹100" (never a hyphen).
  const MINUS = '\u2212';

  if (!booking) {
    // Booking still loading: draw the two always-present lines with placeholder bars.
    return [
      { key: 'base', label: 'Base fare', value: null, slotWidth: 37 },
      { key: 'distance', label: 'Distance charge', value: null, slotWidth: 38 },
    ];
  }

  const { breakdown } = booking;
  const lines: PaymentBillLine[] = [];

  // Base fare: always drawn.
  lines.push({
    key: 'base',
    label: 'Base fare',
    value: formatPaise(breakdown.basePaise),
    slotWidth: 37,
  });

  // Distance charge: always drawn, but the fare formula has no distance term (distance picks the
  // slab, so it is already inside the base fare). Its value is therefore always null.
  const distanceLabel =
    typeof booking.distanceKm === 'number'
      ? `Distance charge (${String(Math.round(booking.distanceKm * 10) / 10)} km)`
      : 'Distance charge';
  lines.push({
    key: 'distance',
    label: distanceLabel,
    value: null,
    slotWidth: 38,
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

  // Discount already on the booking (a coupon applied at confirm).
  if (breakdown.discountPaise > 0) {
    lines.push({
      key: 'booking-discount',
      label: 'Discount',
      value: MINUS + formatPaise(breakdown.discountPaise),
      tone: 'discount',
    });
  }

  // Discount from the coupon applied on 27 (the `coupon` argument).
  if (coupon && coupon.discountPaise > 0) {
    lines.push({
      key: 'coupon-discount',
      label: coupon.code ? `Discount (${coupon.code})` : 'Discount',
      value: MINUS + formatPaise(coupon.discountPaise),
      tone: 'discount',
      slotWidth: 45,
    });
  }

  return lines;
}
