import type {
  AdminCreateNote,
  AdminNote,
  AdminNotesResponse,
  AdminNoteSubjectType,
  AdminUpdateNote,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminNotesMock } from '../mocks/adminNotes.mock';

export interface AdminNotesDataSource {
  list(subjectType: AdminNoteSubjectType, subjectId: string): Promise<AdminNotesResponse>;
  create(input: AdminCreateNote): Promise<AdminNote>;
  update(id: string, input: AdminUpdateNote): Promise<AdminNote>;
  remove(id: string): Promise<void>;
}

const mockSource: AdminNotesDataSource = {
  list: async (subjectType, subjectId) => {
    const all = await resolveMock(env.mockAdminNotesState, adminNotesMock, []);
    const notes = all
      .filter((note) => note.subjectType === subjectType && note.subjectId === subjectId)
      // Pinned first, then newest — the SAME order the server returns, so the
      // mock cannot hide a sorting bug.
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    return { notes };
  },

  // Mock mutations are deliberately no-ops (house rule — see
  // `adminFinanceDataSource`): notes are audited internal records, and proving
  // the write works belongs in the backend suite, which owns the audit
  // assertion (`admin-notes.e2e.spec.ts`).
  create: async () => {
    await mockDelay();
    throw new Error('Mock create is a no-op — proven against the backend');
  },
  update: async () => {
    await mockDelay();
    throw new Error('Mock update is a no-op — proven against the backend');
  },
  remove: async () => {
    await mockDelay();
    throw new Error('Mock delete is a no-op — proven against the backend');
  },
};

const restSource: AdminNotesDataSource = {
  list: (subjectType, subjectId) => {
    const params = new URLSearchParams({ subjectType, subjectId });
    return adminApiFetch<AdminNotesResponse>(`notes?${params.toString()}`);
  },
  create: (input) =>
    adminApiFetch<AdminNote>('notes', { method: 'POST', body: JSON.stringify(input) }),
  update: (id, input) =>
    adminApiFetch<AdminNote>(`notes/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id) => adminApiFetch<void>(`notes/${id}`, { method: 'DELETE' }),
};

export const adminNotesDataSource: AdminNotesDataSource = env.useMocks ? mockSource : restSource;
