import { z } from 'zod';
import { notificationsListResponseSchema } from '../common/notifications';
import { cursorQuerySchema } from '../common/pagination';
import { bookingListResponseSchema } from '../customer/bookings';
import { walletSchema, walletTransactionSchema } from '../customer/payments';
import { savedAddressSchema } from '../customer/addresses';
import { savedVehicleSchema } from '../customer/vehicles';

/**
 * G8's read-only impersonation (§9.4.4).
 *
 * THE DESIGN RULE THIS FILE ENCODES: an impersonation session is a BOOKMARK,
 * not a credential. Nothing here mints a customer token, and no app-view
 * response carries one — "no write route accepts an impersonation session" is
 * true by construction rather than by every write path remembering to check a
 * flag. The session id exists so each read can be audited against it.
 */

export const adminImpersonationStartBodySchema = z.object({
  reason: z.string().trim().min(4).max(500),
});
export type AdminImpersonationStartBody = z.infer<typeof adminImpersonationStartBodySchema>;

export const adminImpersonationEndBodySchema = z.object({
  session: z.uuid(),
});
export type AdminImpersonationEndBody = z.infer<typeof adminImpersonationEndBodySchema>;

export const adminImpersonationSessionSchema = z.object({
  id: z.uuid(),
  adminId: z.uuid(),
  /** Users only today — the routes are `/admin/users/:id/...`. */
  subjectType: z.literal('user'),
  subjectId: z.uuid(),
  reason: z.string(),
  startedAt: z.iso.datetime(),
  /** 30 minutes after `startedAt`; reads after this are refused. */
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type AdminImpersonationSession = z.infer<typeof adminImpersonationSessionSchema>;

export const adminImpersonationResponseSchema = z.object({
  session: adminImpersonationSessionSchema,
});
export type AdminImpersonationResponse = z.infer<typeof adminImpersonationResponseSchema>;

/** Every app-view read carries the session it must be audited against. */
export const adminAppViewQuerySchema = z.object({ session: z.uuid() });
export type AdminAppViewQuery = z.infer<typeof adminAppViewQuerySchema>;

/** Trips and notifications page; the session rides along. */
export const adminAppViewCursorQuerySchema = cursorQuerySchema.extend({ session: z.uuid() });
export type AdminAppViewCursorQuery = z.infer<typeof adminAppViewCursorQuerySchema>;

/**
 * The five sections render what the CUSTOMER sees — the response schemas are
 * the customer contracts, reused wholesale. A second shape here would be the
 * first place the two views could start to disagree.
 */
export const adminAppViewTripsResponseSchema = bookingListResponseSchema;
export type AdminAppViewTripsResponse = z.infer<typeof adminAppViewTripsResponseSchema>;

export const adminAppViewWalletResponseSchema = z.object({
  wallet: walletSchema,
  transactions: z.array(walletTransactionSchema),
});
export type AdminAppViewWalletResponse = z.infer<typeof adminAppViewWalletResponseSchema>;

export const adminAppViewNotificationsResponseSchema = notificationsListResponseSchema;
export type AdminAppViewNotificationsResponse = z.infer<
  typeof adminAppViewNotificationsResponseSchema
>;

export const adminAppViewVehiclesResponseSchema = z.object({
  items: z.array(savedVehicleSchema),
});
export type AdminAppViewVehiclesResponse = z.infer<typeof adminAppViewVehiclesResponseSchema>;

export const adminAppViewAddressesResponseSchema = z.object({
  items: z.array(savedAddressSchema),
});
export type AdminAppViewAddressesResponse = z.infer<typeof adminAppViewAddressesResponseSchema>;
