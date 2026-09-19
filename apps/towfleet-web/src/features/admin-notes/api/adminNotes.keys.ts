import type { AdminNoteSubjectType } from '@towing/api-contracts';

/**
 * W21's panel keys. Keyed by SUBJECT, not by a page: the same subject's notes
 * are the same query wherever the panel is mounted, so a KYC drawer and a
 * driver-directory row share one cache entry.
 */
export const adminNotesKeys = {
  all: ['admin-notes'] as const,
  subject: (subjectType: AdminNoteSubjectType, subjectId: string) =>
    [...adminNotesKeys.all, subjectType, subjectId] as const,
};
