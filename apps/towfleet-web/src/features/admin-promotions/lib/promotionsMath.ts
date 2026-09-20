import type { AdminCoupon, AdminCouponRedemption } from '@towing/api-contracts';

/**
 * The one piece of coupon maths the console needs — the "what the customer
 * sees" preview in the editor.
 *
 * A MIRROR, NOT AN IMPORT: the authoritative clamp lives in the backend's
 * `discountFor` (coupons.service.ts) and runs again at confirm. This copy
 * exists so the editor can show the number without asking the server on every
 * keystroke, and it is deliberately the same three rules — percent rounds to
 * the nearest paisa, `maxDiscountPaise` caps a percent coupon, and everything
 * clamps to the subtotal (a ₹500 flat coupon on a ₹300 fare discounts ₹300).
 * The console labels the result a preview for exactly this reason.
 */
export function previewDiscountPaise(
  coupon: Pick<AdminCoupon, 'kind' | 'percentValue' | 'flatValuePaise' | 'maxDiscountPaise'>,
  subtotalPaise: number,
): number {
  const raw =
    coupon.kind === 'percent'
      ? Math.round((subtotalPaise * (coupon.percentValue ?? 0)) / 100)
      : (coupon.flatValuePaise ?? 0);

  const capped =
    coupon.maxDiscountPaise === null ? raw : Math.min(raw, coupon.maxDiscountPaise);

  return Math.max(0, Math.min(capped, subtotalPaise));
}

/** `20%` / `₹150` — the value cell, in the coupon's own unit. */
export function valueLabel(coupon: AdminCoupon): string {
  if (coupon.kind === 'percent') {
    const cap =
      coupon.maxDiscountPaise === null
        ? ''
        : ` (max ₹${Math.round(coupon.maxDiscountPaise / 100).toLocaleString('en-IN')})`;
    return `${coupon.percentValue ?? 0}%${cap}`;
  }
  return `₹${Math.round((coupon.flatValuePaise ?? 0) / 100).toLocaleString('en-IN')}`;
}

/** `—` for a window that is always open, else the two IST dates. */
export function windowLabel(coupon: AdminCoupon): string {
  if (!coupon.startsAt && !coupon.expiresAt) return 'Always';
  return bannerWindowLabel(coupon.startsAt, coupon.expiresAt);
}

/** The same label shape for a banner's `startsAt`/`endsAt` pair. */
export function bannerWindowLabel(startsAt: string | null, endsAt: string | null): string {
  const format = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
  if (!startsAt && !endsAt) return 'Always live';
  if (startsAt && endsAt) return `${format(startsAt)} → ${format(endsAt)}`;
  return startsAt ? `from ${format(startsAt)}` : `until ${format(endsAt!)}`;
}

/** `1 / 100` or `1 / ∞`, the used-count cell. */
export function usesLabel(coupon: AdminCoupon): string {
  return `${coupon.usedCount} / ${coupon.maxUses ?? '∞'}`;
}

/**
 * `datetime-local` inputs speak local wall-clock (`YYYY-MM-DDTHH:mm`); the API
 * speaks ISO instants. These two functions are the whole bridge.
 */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value.trim().length === 0 ? null : new Date(value).toISOString();
}

/** The recent-redemption line: who used it, on what, and for how much. */
export function redemptionLabel(redemption: AdminCouponRedemption): string {
  return `${redemption.userName ?? 'Unknown'} · ${redemption.bookingCode}`;
}
