import { z } from 'zod';

/**
 * Admin notes (W21, §9.4.4) — internal notes on any subject.
 *
 * Deliberately generic: one `<NotesPanel subjectType subjectId />` drops into
 * every detail screen instead of a user-notes table that gets copied five
 * times. The ten subject types are pinned by `ck_admin_notes_subject_type` in
 * migration 0020 — this enum is the TypeScript half of that same constraint,
 * and `migration-0020.spec.ts` keeps the two lists equal.
 *
 * INTERNAL ONLY. Nothing here is ever joined into a customer, driver or fleet
 * payload, and a source-text guard in the backend asserts it.
 */
export const ADMIN_NOTE_SUBJECT_TYPES = [
  'user',
  'driver',
  'fleet',
  'booking',
  'dispute',
  'sos_alert',
  'support_ticket',
  'truck',
  'payout',
  'deletion_request',
] as const;

export const adminNoteSubjectTypeSchema = z.enum(ADMIN_NOTE_SUBJECT_TYPES);
export type AdminNoteSubjectType = z.infer<typeof adminNoteSubjectTypeSchema>;

export const adminNoteSchema = z.object({
  id: z.uuid(),
  subjectType: adminNoteSubjectTypeSchema,
  subjectId: z.uuid(),
  /** Who wrote it — the console shows the author next to the body. */
  adminId: z.uuid(),
  body: z.string(),
  /** Pinned notes sort first; pinning is a UI decision, not a workflow. */
  pinned: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminNote = z.infer<typeof adminNoteSchema>;

export const adminNotesResponseSchema = z.object({
  notes: z.array(adminNoteSchema),
});
export type AdminNotesResponse = z.infer<typeof adminNotesResponseSchema>;

export const adminNotesQuerySchema = z.object({
  subjectType: adminNoteSubjectTypeSchema,
  subjectId: z.uuid(),
});
export type AdminNotesQuery = z.infer<typeof adminNotesQuerySchema>;

export const adminCreateNoteSchema = z.object({
  subjectType: adminNoteSubjectTypeSchema,
  subjectId: z.uuid(),
  // Trimmed before the min: a body of spaces is an empty note, and the DB has
  // no CHECK for it because the API is the only writer.
  body: z.string().trim().min(1).max(4000),
  pinned: z.boolean().optional(),
});
export type AdminCreateNote = z.infer<typeof adminCreateNoteSchema>;

export const adminUpdateNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    pinned: z.boolean().optional(),
  })
  // An empty PATCH is almost always a bug in the caller — the console's edit
  // dialog may legitimately send only one field, but never zero.
  .refine((value) => value.body !== undefined || value.pinned !== undefined, {
    message: 'Provide at least one of body or pinned',
  });
export type AdminUpdateNote = z.infer<typeof adminUpdateNoteSchema>;
