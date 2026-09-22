import { z } from 'zod';
import { mobileSchema } from '../common/auth';

/**
 * `GET/POST/PUT/DELETE /v1/me/emergency-contacts` (Phase 12) — a hard §13 (SOS)
 * prerequisite, captured here rather than in Phase 20.
 */
export const emergencyContactSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  relation: z.string().nullable(),
});
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

export const emergencyContactCreateSchema = z.object({
  name: z.string().min(1).max(120),
  phone: mobileSchema,
  relation: z.string().min(1).max(60).optional(),
});
export type EmergencyContactCreate = z.infer<typeof emergencyContactCreateSchema>;

export const emergencyContactUpdateSchema = emergencyContactCreateSchema
  .partial()
  .extend({ relation: z.string().min(1).max(60).nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type EmergencyContactUpdate = z.infer<typeof emergencyContactUpdateSchema>;
