import type { FareBreakdown, PricingEstimateResponse } from '@towing/api-contracts';
import type { MiColorIconName } from '@/design';

/**
 * `heavy` and `euro` stay in the id union so older bookings that carry them
 * still type-check, but the picker (Figma 14) only offers Car, SUV and Bike.
 */
export type TowTypeId = 'light' | 'medium' | 'bike' | 'heavy' | 'euro';

export type TowType = {
  id: TowTypeId;
  /** Figma 14 card name ("Car"). Also the vehicle slot in 15's subtitle ("Tow a Car · …"). */
  name: string;
  /** Figma 14 card sub line ("Hatchback / Sedan"). */
  categories: string;
  /** Which §7 base matrix this vehicle bills against (§7.1 wheel-lift or §7.2 flatbed). */
  vehicleClass: 'wheel_lift' | 'flatbed';
  /** Figma `icon/color/*` glyph drawn on the card (transparent PNG). */
  icon: MiColorIconName;
};

/**
 * APP-LOCAL EXTENSION of `POST /v1/pricing/estimate` for Figma 14 and 15.
 *
 * The contract (`packages/api-contracts`) has no fields for several values the
 * design draws. Every extra is OPTIONAL, so the REST response still satisfies
 * this type unchanged; the mock source fills them so mock mode shows the
 * design in full. See the booking data gaps: each field below needs a backend
 * counterpart before it renders against the real API.
 */
export type FareBreakdownExtended = FareBreakdown & {
  /** 15 "Distance charge (8.2 km)". Split out of `basePaise` (the backend folds distance into base). */
  distancePaise?: number;
};

export type FareEstimate = Omit<PricingEstimateResponse, 'breakdown'> & {
  breakdown: FareBreakdownExtended;
  /** 15 "Discount (TOW100)": the applied coupon code. */
  couponCode?: string;
  /** 14 "₹1,200 – ₹1,500": low end of the fare range. */
  totalMinPaise?: number;
  /** 14 "₹1,200 – ₹1,500": high end of the fare range. */
  totalMaxPaise?: number;
};
