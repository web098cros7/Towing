import { z } from 'zod';
import { pageEnvelopeSchema, pageQuerySchema } from '../common/pagination';

export const vehicleClassSchema = z.enum(['wheel_lift', 'flatbed']);
export const truckStatusSchema = z.enum(['active', 'inactive', 'non_compliant']);
export const complianceDocTypeSchema = z.enum(['insurance', 'rc', 'puc', 'permit']);

/**
 * Client-facing compliance status. The DB spells `expiring_soon`; the console
 * spells `expiring`, and `missing` is synthesized server-side for doc types
 * with no row (synthetic id `${truckId}:${docType}`).
 */
export const complianceStatusSchema = z.enum(['valid', 'expiring', 'expired', 'missing']);

export const complianceDocSchema = z.object({
  id: z.string(),
  docType: complianceDocTypeSchema,
  issuedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  status: complianceStatusSchema,
});
export type ComplianceDocDto = z.infer<typeof complianceDocSchema>;

export const latLngSchema = z.object({ lat: z.number(), lng: z.number() });

/**
 * A truck's make or model ("Tata", "407"), shown on the customer's vehicle card
 * (Figma 18/20). Optional: an empty string clears it, and the server stores null.
 */
export const truckMakeModelSchema = z.string().trim().max(40, 'At most 40 characters');

export const truckSchema = z.object({
  id: z.uuid(),
  plate: z.string(),
  type: vehicleClassSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  /** DB stores text like "5t"; the API speaks numbers. 0 when unparseable. */
  capacityTons: z.number(),
  status: truckStatusSchema,
  assignedDriverName: z.string().nullable(),
  /** Pre-wired for the Phase 5 live map; null until a ping lands. */
  currentLocation: latLngSchema.nullable(),
  lastPingAt: z.iso.datetime().nullable(),
  compliance: z.array(complianceDocSchema),
});
export type TruckDto = z.infer<typeof truckSchema>;

export const trucksListQuerySchema = pageQuerySchema.extend({
  status: truckStatusSchema.optional(),
});
export type TrucksListQuery = z.infer<typeof trucksListQuerySchema>;

export const trucksListResponseSchema = pageEnvelopeSchema(truckSchema);
export type TrucksListResponse = z.infer<typeof trucksListResponseSchema>;

export const truckCreateSchema = z.object({
  plate: z.string().min(4).max(20),
  type: vehicleClassSchema,
  capacityTons: z.number().positive().max(50),
  make: truckMakeModelSchema.nullable().optional(),
  model: truckMakeModelSchema.nullable().optional(),
});
export type TruckCreateRequest = z.infer<typeof truckCreateSchema>;

/** Clients may park a truck but never hand-set `non_compliant` — that state is computed. */
export const truckUpdateSchema = z
  .object({
    plate: z.string().min(4).max(20),
    type: vehicleClassSchema,
    capacityTons: z.number().positive().max(50),
    make: truckMakeModelSchema.nullable(),
    model: truckMakeModelSchema.nullable(),
    status: z.enum(['active', 'inactive']),
  })
  .partial();
export type TruckUpdateRequest = z.infer<typeof truckUpdateSchema>;

/** Multipart text fields arrive as strings — coerce dates. File is optional. */
export const complianceUpsertSchema = z.object({
  docType: complianceDocTypeSchema,
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});
export type ComplianceUpsertRequest = z.infer<typeof complianceUpsertSchema>;
