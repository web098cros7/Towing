import type { ImageSourcePropType } from 'react-native';
import { BatteryCharging, Bike, CarFront, LifeBuoy, Fuel, Truck, Wrench } from '@/icons';
import type { IconComponent } from '@towing/ui';

/**
 * Artwork for a `services.slug`, and all that remains of the old
 * `services.data.ts`.
 *
 * THE CATALOGUE ITSELF NOW COMES FROM `GET /v1/services` (§16.2). What a bundled
 * array can legitimately own is the artwork — a `require()`d PNG or a curated
 * Lucide glyph cannot come down a wire — so this maps slug → image and the
 * server supplies the name, the description, the order and whether the row is
 * still active.
 *
 * TWO SERVICES DISAPPEARED IN THE SWAP, and both have since come back properly.
 * The static list carried `lockout` and `winch_out` before either had a
 * `service_type` or a fare, so the app was advertising services the platform
 * could not price, quote or dispatch. Lockout returned with Figma 09 (migration
 * 0035). Winch Out now exists server-side (migration 0039) and is priced from
 * the admin panel, but no customer screen offers it: it has no card in the
 * Figma this app is built from, so it has no artwork here either.
 *
 * An unknown slug falls back to `Wrench` rather than rendering nothing, so an
 * admin adding a catalogue row does not need an app release to make it visible.
 */
export interface ServiceArtwork {
  icon?: IconComponent;
  image?: ImageSourcePropType;
}

const ARTWORK: Record<string, ServiceArtwork> = {
  car_tow: { image: require('@/assets/icons/qa-tow.png') },
  bike_tow: { icon: Bike },
  flatbed_tow: { icon: Truck },
  wheel_lift_tow: { icon: CarFront },
  battery: { icon: BatteryCharging },
  flat_tyre: { icon: LifeBuoy },
  fuel: { icon: Fuel },
  breakdown: { icon: Wrench },
  accident_recovery: { icon: Truck },
};

export function artworkFor(slug: string): ServiceArtwork {
  return ARTWORK[slug] ?? { icon: Wrench };
}
