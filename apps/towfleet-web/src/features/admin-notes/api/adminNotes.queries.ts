'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCreateNote, AdminNoteSubjectType, AdminUpdateNote } from '@towing/api-contracts';
import { adminNotesKeys } from './adminNotes.keys';
import { adminNotesDataSource } from './adminNotesDataSource';

/**
 * `staleTime: 0` with focus refetch: notes are how one operator tells the next
 * what they found, and a panel showing a colleague's note from twenty minutes
 * ago is the failure mode that matters.
 */
export function useAdminNotes(subjectType: AdminNoteSubjectType, subjectId: string) {
  return useQuery({
    queryKey: adminNotesKeys.subject(subjectType, subjectId),
    queryFn: () => adminNotesDataSource.list(subjectType, subjectId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useCreateNote(subjectType: AdminNoteSubjectType, subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AdminCreateNote, 'subjectType' | 'subjectId'>) =>
      adminNotesDataSource.create({ ...input, subjectType, subjectId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminNotesKeys.subject(subjectType, subjectId),
      });
    },
  });
}

export function useUpdateNote(subjectType: AdminNoteSubjectType, subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminUpdateNote }) =>
      adminNotesDataSource.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminNotesKeys.subject(subjectType, subjectId),
      });
    },
  });
}

export function useDeleteNote(subjectType: AdminNoteSubjectType, subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminNotesDataSource.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: adminNotesKeys.subject(subjectType, subjectId),
      });
    },
  });
}
