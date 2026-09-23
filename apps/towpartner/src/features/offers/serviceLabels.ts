import type { ServiceType } from '@towing/api-contracts';
import type { IconComponent } from '@towing/ui';
import {
  Truck,
  BatteryCharging,
  LifeBuoy,
  Fuel,
  Lock,
  Wrench,
  Shield,
  Cable,
} from '@/icons';

/**
 * The words the driver app shows for a `ServiceType`.
 *
 * A Record, not a ternary — a new service type becomes a compile error, not a
 * silent fallback to "Tow". Kept in step with the customer app's
 * `features/services/data/serviceTitles.ts`, which names the same services on
 * 27 · Payment and 30 · Payment Successful.
 */
export const SERVICE_LABEL: Record<ServiceType, string> = {
  tow: 'Tow a Car',
  battery: 'Battery Jump Start',
  flat_tyre: 'Flat Tyre Support',
  fuel: 'Out of Fuel',
  lockout: 'Car Lockout',
  breakdown: 'Minor Mechanical Help',
  accident_recovery: 'Accident Recovery',
  winch_out: 'Winch Out',
};

/** The icon that stands for each service, wherever a service is named. */
export const SERVICE_ICON: Record<ServiceType, IconComponent> = {
  tow: Truck,
  battery: BatteryCharging,
  flat_tyre: LifeBuoy,
  fuel: Fuel,
  lockout: Lock,
  breakdown: Wrench,
  accident_recovery: Shield,
  winch_out: Cable,
};

/**
 * The service's on-screen name for a job or offer.
 *
 * A tow and an accident recovery are the two services whose price and equipment
 * depend on the truck, so those two carry the vehicle class after the label —
 * "Tow a Car · Flatbed". Every other service is done at the spot with whatever
 * the driver arrived in, so the class would be noise.
 */
export function serviceLabel(job: {
  serviceType: ServiceType;
  vehicleClass: 'flatbed' | 'wheel_lift';
}): string {
  const t = job.serviceType;
  if (t === 'tow' || t === 'accident_recovery') {
    return `${SERVICE_LABEL[t]} · ${job.vehicleClass === 'flatbed' ? 'Flatbed' : 'Wheel-lift'}`;
  }
  return SERVICE_LABEL[t];
}

/**
 * Roadside service happens where the car is; there is no drop leg.
 *
 * A job whose `drop` is null is an at-the-spot job — battery, tyre, fuel,
 * lockout, breakdown — and the UI must not draw a "Drop" row for it.
 */
export function isAtTheSpot(job: { drop: unknown | null }): boolean {
  return job.drop === null;
}
