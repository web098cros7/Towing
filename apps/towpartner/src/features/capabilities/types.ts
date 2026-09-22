import type { DriverCapabilitiesResponse, DriverCapabilitiesUpdate } from '@towing/api-contracts';

export type { DriverCapabilitiesResponse, DriverCapabilitiesUpdate };

export type VehicleClass = NonNullable<DriverCapabilitiesUpdate['vehicleClass']>;

/**
 * Mirrors `vehicleClassSchema` (`packages/api-contracts/src/fleet/trucks.ts`)
 * — that file exports the zod schema but no plain values array, and pulling
 * in `zod` here just to read `.options` off it isn't worth a new app
 * dependency for two literals. Update both if the schema's enum ever changes.
 */
export const VEHICLE_CLASS_OPTIONS: readonly { value: VehicleClass; label: string }[] = [
  { value: 'wheel_lift', label: 'Wheel Lift' },
  { value: 'flatbed', label: 'Flatbed' },
];
