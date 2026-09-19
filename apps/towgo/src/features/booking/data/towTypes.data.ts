import type { TowType } from '../types';

/**
 * Figma 14 "Select Vehicle": exactly the three drawn tiles, Car, SUV and Bike.
 *
 * The ids and the §7 base matrix each bills against are unchanged, so pricing
 * is unaffected: a car bills wheel-lift, an SUV flatbed (§7.2), a bike
 * wheel-lift (and the `bike_tow` catalogue row pins wheel-lift anyway).
 */
export const towTypes: TowType[] = [
  {
    id: 'light',
    name: 'Car',
    categories: 'Hatchback / Sedan',
    vehicleClass: 'wheel_lift',
    icon: 'car',
  },
  {
    id: 'medium',
    name: 'SUV',
    categories: 'SUV / MUV',
    vehicleClass: 'flatbed',
    icon: 'suv',
  },
  {
    id: 'bike',
    name: 'Bike',
    categories: '2 Wheeler',
    vehicleClass: 'wheel_lift',
    icon: 'bike',
  },
];

/** The §7 base matrix a vehicle bills against. Falls back to wheel-lift. */
export function vehicleClassFor(id: TowType['id']): 'wheel_lift' | 'flatbed' {
  return towTypes.find((type) => type.id === id)?.vehicleClass ?? 'wheel_lift';
}

/**
 * The tow-method slot of Figma 15's subtitle ("Tow a Car · Flatbed · …"), bound
 * to the class the estimate actually bills.
 *
 * Only "Flatbed" is drawn. The design pairs it with Car, but `car_tow` leaves
 * the class open and a Car bills wheel-lift (above), so a Car quote reads
 * "Wheel-lift", the same label 18's Vehicle Card and the `wheel_lift_tow`
 * catalogue row use. Showing "Flatbed" for a wheel-lift job would promise the
 * customer a truck that is not coming. The owner has to decide the Car mapping.
 */
const TOW_METHOD_LABELS: Record<'wheel_lift' | 'flatbed', string> = {
  flatbed: 'Flatbed',
  wheel_lift: 'Wheel-lift',
};

export function towMethodLabelFor(vehicleClass: 'wheel_lift' | 'flatbed'): string {
  return TOW_METHOD_LABELS[vehicleClass];
}
