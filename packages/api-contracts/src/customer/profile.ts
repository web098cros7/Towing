import { z } from 'zod';

/**
 * `GET/PUT /v1/me` (Phase 12) — the customer's own profile. `mobile` is the
 * auth key (unique on `users`) and is deliberately absent from the update
 * schema: changing it would mean re-verifying a new number, which is a
 * re-authentication flow this phase does not build, not a profile edit.
 */

/** Figma 54's language choices. Saved per account; the app is English-only until translations land. */
export const CUSTOMER_LANGUAGES = ['en', 'hi', 'kn', 'ta', 'te', 'ml', 'mr', 'bn'] as const;
export const customerLanguageSchema = z.enum(CUSTOMER_LANGUAGES);
export type CustomerLanguage = z.infer<typeof customerLanguageSchema>;

/** Theme preference; `system` follows the OS setting. */
export const CUSTOMER_APPEARANCES = ['light', 'dark', 'system'] as const;
export const customerAppearanceSchema = z.enum(CUSTOMER_APPEARANCES);
export type CustomerAppearance = z.infer<typeof customerAppearanceSchema>;

export const customerProfileSchema = z.object({
  id: z.uuid(),
  mobile: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  photoUrl: z.string().nullable(),
  /** Null means "not chosen yet" — the app falls back to device locale. */
  language: customerLanguageSchema.nullable(),
  /** Null means "not chosen yet" — the app falls back to the OS theme. */
  appearance: customerAppearanceSchema.nullable(),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;

export const customerProfileUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().nullable().optional(),
  language: customerLanguageSchema.nullable().optional(),
  appearance: customerAppearanceSchema.nullable().optional(),
});
export type CustomerProfileUpdate = z.infer<typeof customerProfileUpdateSchema>;

/** `POST /v1/me/photo/presign` — a slot to PUT the profile photo bytes to. */
export const customerPhotoPresignResponseSchema = z.object({
  uploadUrl: z.string(),
  key: z.string(),
  expiresAt: z.iso.datetime(),
});
export type CustomerPhotoPresignResponse = z.infer<typeof customerPhotoPresignResponseSchema>;

/** `POST /v1/me/photo/confirm` — the key from the presign response, once uploaded. */
export const customerPhotoConfirmSchema = z.object({
  key: z.string().min(1).max(300),
});
export type CustomerPhotoConfirm = z.infer<typeof customerPhotoConfirmSchema>;
