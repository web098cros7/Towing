import { z } from 'zod';
import { complianceDocSchema, truckStatusSchema, vehicleClassSchema } from '../fleet/trucks';

/**
 * The driver sees their truck's papers but cannot change them — renewal is the
 * fleet's job (or MiTow's, for an independent driver), which is why there is no
 * write route here.
 *
 * `documents` is always the full four-item checklist; a type with no row comes
 * back `missing`. An independent driver, or one with no truck assigned yet,
 * gets `truck: null` and an empty array.
 */
export const driverTruckSchema = z.object({
  truck: z
    .object({
      id: z.uuid(),
      plate: z.string(),
      make: z.string().nullable(),
      model: z.string().nullable(),
      vehicleClass: vehicleClassSchema,
      status: truckStatusSchema,
    })
    .nullable(),
  fleetName: z.string().nullable(),
  documents: z.array(complianceDocSchema),
});
export type DriverTruck = z.infer<typeof driverTruckSchema>;
