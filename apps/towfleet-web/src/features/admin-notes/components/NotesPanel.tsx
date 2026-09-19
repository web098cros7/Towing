'use client';

import { useState } from 'react';
import { Pin, Trash2 } from 'lucide-react';
import { Button, RelativeTime, Skeleton, Textarea } from '@towing/web-ui';
import type { AdminNote, AdminNoteSubjectType } from '@towing/api-contracts';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useAdminNotes,
  useCreateNote,
  useDeleteNote,
  useUpdateNote,
} from '../api/adminNotes.queries';

/**
 * W21's `<NotesPanel subjectType subjectId />` (§9.4.4) — one component that
 * drops into every detail screen.
 *
 * READ ALL, EDIT YOUR OWN: anyone who may open the subject reads every note on
 * it (that is the point of the panel), while the pin/delete affordances appear
 * only on the signed-in admin's own notes — the same author-or-super-admin rule
 * the API enforces, mirrored here as UX. The API is still the gate.
 *
 * The panel is INTERNAL ONLY: it renders on admin screens, and the backend's
 * source guard keeps `admin_notes` out of every customer/driver/fleet payload.
 */
export function NotesPanel({
  subjectType,
  subjectId,
  className,
}: {
  subjectType: AdminNoteSubjectType;
  subjectId: string;
  className?: string;
}) {
  const { admin } = useAdminIdentity();
  const toast = useToast();
  const notes = useAdminNotes(subjectType, subjectId);
  const create = useCreateNote(subjectType, subjectId);
  const update = useUpdateNote(subjectType, subjectId);
  const remove = useDeleteNote(subjectType, subjectId);

  const [body, setBody] = useState('');

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;

    create.mutate(
      { body: trimmed },
      {
        onSuccess: () => {
          setBody('');
          toast('Note added', 'success');
        },
        onError: (error) => toast((error as Error).message, 'error'),
      },
    );
  };

  const togglePin = (note: AdminNote) => {
    update.mutate(
      { id: note.id, input: { pinned: !note.pinned } },
      { onError: (error) => toast((error as Error).message, 'error') },
    );
  };

  const deleteNote = (note: AdminNote) => {
    remove.mutate(note.id, {
      onSuccess: () => toast('Note deleted', 'success'),
      onError: (error) => toast((error as Error).message, 'error'),
    });
  };

  return (
    <section className={className} aria-label="Internal notes">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Internal notes</h3>
        {notes.data ? (
          <span className="text-xs text-text-tertiary" data-testid="notes-count">
            {notes.data.notes.length}
          </span>
        ) : null}
      </div>

      {notes.isError ? (
        <p className="text-sm text-error">Could not load notes.</p>
      ) : notes.isLoading || !notes.data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : notes.data.notes.length === 0 ? (
        <p className="text-sm text-text-tertiary" data-testid="notes-empty">
          No notes yet. Notes are internal — they never reach the driver, fleet or customer.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="notes-list">
          {notes.data.notes.map((note) => {
            const mine = admin?.id === note.adminId;
            return (
              <li
                key={note.id}
                data-testid="note-item"
                className="rounded-card border border-border p-3"
              >
                <div className="flex items-start gap-2">
                  {note.pinned ? (
                    <Pin className="mt-0.5 size-3.5 shrink-0 text-brand" aria-label="Pinned" />
                  ) : null}
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{note.body}</p>
                  {mine ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                        data-testid={`note-pin-${note.id}`}
                        disabled={update.isPending}
                        onClick={() => togglePin(note)}
                      >
                        <Pin className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete note"
                        data-testid={`note-delete-${note.id}`}
                        disabled={remove.isPending}
                        onClick={() => deleteNote(note)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs text-text-tertiary">
                  <span className="font-mono">{note.adminId.slice(0, 8)}…</span> ·{' '}
                  <RelativeTime at={note.createdAt} />
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <Textarea
          rows={2}
          placeholder="Add a note for the next operator…"
          aria-label="New note"
          data-testid="note-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            data-testid="note-submit"
            // Same minimum the API enforces, so the button cannot submit a
            // body the server would 422.
            disabled={body.trim().length === 0 || create.isPending}
            onClick={submit}
          >
            {create.isPending ? 'Adding…' : 'Add note'}
          </Button>
        </div>
      </div>
    </section>
  );
}
