import { z } from 'zod';

/**
 * W6's directory contracts — users/drivers/fleets search and detail, suspension
 * (self-service requests included), and read-only impersonation (G8).
 *
 * The two union constants below are the source of truth for migration 0024's
 * CHECK constraints: `migration-0024.spec.ts` pins the SQL literals to these
 * lists — the house rule wherever a CHECK duplicates a TypeScript union.
 */

/** Who a suspension request can be about. */
export const SUSPENSION_REQUEST_SUBJECT_TYPES = ['user', 'driver', 'fleet'] as const;
export const suspensionRequestSubjectTypeSchema = z.enum(SUSPENSION_REQUEST_SUBJECT_TYPES);
export type SuspensionRequestSubjectType = z.infer<typeof suspensionRequestSubjectTypeSchema>;

/** The request lifecycle: `open` → `approved` | `rejected`; one open per subject. */
export const SUSPENSION_REQUEST_STATUSES = ['open', 'approved', 'rejected'] as const;
export const suspensionRequestStatusSchema = z.enum(SUSPENSION_REQUEST_STATUSES);
export type SuspensionRequestStatus = z.infer<typeof suspensionRequestStatusSchema>;
