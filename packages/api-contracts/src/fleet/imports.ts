import { z } from 'zod';
import { truckMakeModelSchema, vehicleClassSchema } from './trucks';

/**
 * Bulk truck CSV import (§9.3.4).
 *
 * The console pre-validates every row against `truckImportRowSchema` with Papa
 * Parse before uploading, so the common mistakes (wrong header, bad plate,
 * non-numeric capacity) are shown next to the file picker instead of after a
 * round trip. The server re-validates with the SAME schema — client validation
 * is a courtesy, never a trust boundary.
 */

/** Exact header the CSV must carry, in this order. Also the template download. */
export const TRUCK_IMPORT_COLUMNS = ['plate', 'type', 'capacityTons'] as const;

/**
 * Columns a file MAY carry after the required ones. A file without them still
 * imports (older templates), and a blank cell means "not known".
 */
export const TRUCK_IMPORT_OPTIONAL_COLUMNS = ['make', 'model'] as const;

export const truckImportRowSchema = z.object({
  plate: z
    .string()
    .trim()
    .min(4, 'Plate must be at least 4 characters')
    .max(20, 'Plate must be at most 20 characters')
    // Uppercased on the way in so "ka-01-ab-1234" and "KA-01-AB-1234" cannot
    // both be inserted past the per-fleet unique plate index.
    .transform((v) => v.toUpperCase()),
  type: vehicleClassSchema,
  capacityTons: z.coerce
    .number({ error: 'Capacity must be a number' })
    .positive('Capacity must be greater than 0')
    .max(50, 'Capacity must be at most 50'),
  make: truckMakeModelSchema.optional(),
  model: truckMakeModelSchema.optional(),
});
export type TruckImportRow = z.infer<typeof truckImportRowSchema>;

/** One line of the downloadable error report (§9.3.4 `row, field, code, message`). */
export const importRowErrorSchema = z.object({
  /** 1-based, header excluded — the number the operator sees in Excel. */
  row: z.number().int().positive(),
  field: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ImportRowErrorDto = z.infer<typeof importRowErrorSchema>;

export const importStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export type ImportStatus = z.infer<typeof importStatusSchema>;

export const truckImportSchema = z.object({
  id: z.uuid(),
  filename: z.string().nullable(),
  status: importStatusSchema,
  totalRows: z.number().int(),
  importedRows: z.number().int(),
  failedRows: z.number().int(),
  /**
   * Capped — a 10k-row disaster must not become a 10k-entry response. The
   * downloadable CSV carries the same (capped) set.
   */
  errors: z.array(importRowErrorSchema),
  /** Set only when the whole import failed, as opposed to individual rows. */
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type TruckImportDto = z.infer<typeof truckImportSchema>;

/** Errors beyond this are counted but not listed. */
export const IMPORT_ERROR_REPORT_CAP = 500;

export const importErrorCodes = {
  VALIDATION_FAILED: 'validation_failed',
  DUPLICATE_PLATE: 'duplicate_plate',
  /** The same plate appears twice inside the uploaded file. */
  DUPLICATE_IN_FILE: 'duplicate_in_file',
} as const;
