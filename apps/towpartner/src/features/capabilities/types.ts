import {
  type DriverCapabilitiesResponse,
  type DriverCapabilitiesUpdate,
  type OptionalServiceType,
} from '@towing/api-contracts';

export type { DriverCapabilitiesResponse, DriverCapabilitiesUpdate, OptionalServiceType };

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

/**
 * The roadside services a driver ticks, in the order they appear on the
 * Capabilities card.
 *
 * The labels are the app's, not the contract's — a driver reads "Jump start",
 * not `battery` — so the list is written out here and held to the contract by
 * the check below rather than derived from it.
 *
 * `kit` is the honest question behind each label. A driver skimming five rows
 * decides fastest against a thing they either carry or do not.
 */
export const SERVICE_OPTIONS = [
  { value: 'battery', label: 'Jump start', kit: 'You carry a jump pack or booster cables' },
  { value: 'flat_tyre', label: 'Flat tyre', kit: 'You carry a jack and wheel spanner' },
  { value: 'fuel', label: 'Fuel delivery', kit: 'You carry an approved fuel can' },
  { value: 'lockout', label: 'Car lockout', kit: 'You carry a lockout kit' },
  { value: 'breakdown', label: 'Breakdown help', kit: 'You can do minor roadside repairs' },
  { value: 'winch_out', label: 'Winch out', kit: 'Your truck has a working winch and recovery straps' },
] as const satisfies readonly { value: OptionalServiceType; label: string; kit: string }[];

/**
 * Compile-time: every optional service in the contract has a row above.
 *
 * Add one to `OPTIONAL_SERVICE_TYPES` without adding a row and this stops
 * compiling — the failure mode it guards is quiet. The backend would accept
 * the new service, dispatch would require the opt-in, and no driver would ever
 * see a control to give it, so the service would simply never dispatch.
 */
const _everyServiceHasARow: OptionalServiceType extends (typeof SERVICE_OPTIONS)[number]['value']
  ? true
  : never = true;
void _everyServiceHasARow;
