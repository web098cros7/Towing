'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Skeleton,
  StatusChip,
} from '@towing/web-ui';
import type {
  AdminDisputeDetail,
  AdminDisputeResolveBody,
  DisputeStatus,
} from '@towing/api-contracts';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { useToast } from '@/components/admin/ToastProvider';
import { NotesPanel } from '@/features/admin-notes/components/NotesPanel';
import { bearerShortLabel } from '@/features/admin-finance/components/RefundTermsFields';
import { formatPaise } from '@/lib/money';
import { useAdminDispute } from '../api/adminDisputes.queries';
import {
  useAddDisputeNote,
  useAssignDispute,
  useResolveDispute,
} from '../api/adminDisputes.mutations';
import { DISPUTE_REASON_LABELS } from '@/features/admin-bookings/components/bookingStatus';
import { ResolveDisputePanel } from './ResolveDisputePanel';
import { BOOKING_STATUS_TONES } from '@/features/admin-bookings/components/bookingStatus';

const STATUS_TONE: Record<DisputeStatus, 'warning' | 'info' | 'success'> = {
  open: 'warning',
  under_review: 'info',
  resolved: 'success',
};

const at = (value: string | null): string =>
  value
    ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

/**
 * The dispute drawer: everything about one complaint in the place the queue
 * click lands, with the three writes an operator runs — assign, note, resolve.
 *
 * The evidence grid renders the API's presigned URLs as they arrive (they are
 * short-lived by design; the detail query refetches on focus rather than
 * pinning a dead link for the session). Uploading new evidence rides the KYC
 * presign→PUT→confirm shape and stays a LIVE-only affordance here: the proxy
 * has no route for raw file bytes under mocks.
 */
export function DisputeDrawer({
  disputeId,
  onClose,
}: {
  disputeId: string | null;
  onClose: () => void;
}) {
  const { admin } = useAdminIdentity();
  const toast = useToast();
  const detail = useAdminDispute(disputeId);

  const assign = useAssignDispute(disputeId ?? '');
  const note = useAddDisputeNote(disputeId ?? '');
  const resolve = useResolveDispute(disputeId ?? '');

  const [noteText, setNoteText] = useState('');

  const open = disputeId !== null;

  return (
    <Drawer open={open} onClose={onClose} labelledBy="dispute-drawer-title">
      <DrawerHeader>
        <DrawerTitle id="dispute-drawer-title">
          {detail.data ? `Dispute — ${detail.data.booking.code}` : 'Dispute'}
        </DrawerTitle>
      </DrawerHeader>

      <DrawerBody>
        {detail.isLoading || !detail.data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : detail.isError ? (
          <p className="text-sm text-error">Could not load this dispute.</p>
        ) : (
          <DisputeBody
            dispute={detail.data}
            currentAdminId={admin?.id ?? null}
            noteText={noteText}
            onNoteText={setNoteText}
            onAssignToMe={() =>
              assign.mutate(
                { adminId: admin?.id },
                {
                  onSuccess: () => toast('Assigned to you', 'success'),
                  onError: (error) => toast((error as Error).message, 'error'),
                },
              )
            }
            isAssigning={assign.isPending}
            onAddNote={() => {
              const trimmed = noteText.trim();
              if (trimmed.length < 2) return;
              note.mutate(
                { note: trimmed },
                {
                  onSuccess: () => {
                    setNoteText('');
                    toast('Note added', 'success');
                  },
                  onError: (error) => toast((error as Error).message, 'error'),
                },
              );
            }}
            isNoting={note.isPending}
            onResolve={async (body) => {
              const result = await resolve.mutateAsync(body);
              toast(
                result.refundAmountPaise !== null
                  ? `Resolved — refund of ${formatPaise(result.refundAmountPaise)} issued.`
                  : 'Dispute resolved.',
                'success',
              );
              return result;
            }}
            isResolving={resolve.isPending}
          />
        )}
      </DrawerBody>

      <DrawerFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

function DisputeBody({
  dispute,
  currentAdminId,
  noteText,
  onNoteText,
  onAssignToMe,
  isAssigning,
  onAddNote,
  isNoting,
  onResolve,
  isResolving,
}: {
  dispute: AdminDisputeDetail;
  currentAdminId: string | null;
  noteText: string;
  onNoteText: (value: string) => void;
  onAssignToMe: () => void;
  isAssigning: boolean;
  onAddNote: () => void;
  isNoting: boolean;
  onResolve: (body: AdminDisputeResolveBody) => Promise<unknown>;
  isResolving: boolean;
}) {
  const mine = currentAdminId !== null && dispute.assignedAdminId === currentAdminId;
  const resolved = dispute.status === 'resolved';

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={dispute.status} tone={STATUS_TONE[dispute.status]} />
          <StatusChip status={dispute.reasonCode.replace(/_/g, ' ')} tone="neutral" />
          <span className="text-xs text-text-secondary">
            opened from {dispute.openedFromStatus.replace(/_/g, ' ')} · {at(dispute.createdAt)}
          </span>
        </div>
        <p className="mt-2 text-sm" data-testid="dispute-description">
          {dispute.description}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={`/admin/bookings/${dispute.bookingId}`}
            className="font-medium text-brand underline underline-offset-2"
            data-testid="dispute-booking-link"
          >
            {dispute.booking.code} — open booking
          </Link>
          <StatusChip
            status={dispute.booking.status}
            tone={BOOKING_STATUS_TONES[dispute.booking.status]}
          />
          <span className="text-text-secondary">{formatPaise(dispute.booking.totalPaise)}</span>
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          {dispute.booking.customerName ?? 'Customer'} · {dispute.booking.driverName ?? 'No driver'}
        </p>
      </section>

      {resolved ? (
        <section data-testid="dispute-resolution">
          <h3 className="mb-2 text-sm font-semibold">Resolution</h3>
          <div className="rounded-card border border-border p-3 text-sm">
            <p className="font-medium capitalize">{dispute.resolution?.replace(/_/g, ' ')}</p>
            {dispute.refundAmountPaise !== null ? (
              <p className="mt-1">
                Refunded {formatPaise(dispute.refundAmountPaise)}
                {dispute.liability ? ` · paid by ${bearerShortLabel(dispute.liability)}` : ''}
              </p>
            ) : null}
            {dispute.resolutionNote ? (
              <p className="mt-1 text-text-secondary">{dispute.resolutionNote}</p>
            ) : null}
            <p className="mt-1 text-xs text-text-tertiary">Resolved {at(dispute.resolvedAt)}</p>
          </div>
        </section>
      ) : (
        <>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Owner</h3>
            <div className="flex items-center gap-3 text-sm">
              <span>
                {dispute.assignedAdminName ?? (mine ? 'You' : 'Unassigned — nobody is on this yet')}
              </span>
              {!mine ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAssignToMe}
                  disabled={isAssigning}
                  data-testid="dispute-assign-me"
                >
                  {isAssigning ? 'Assigning…' : 'Assign to me'}
                </Button>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Evidence</h3>
            {dispute.evidence.length === 0 ? (
              <p className="text-sm text-text-tertiary" data-testid="dispute-evidence-empty">
                No evidence attached yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="dispute-evidence">
                {dispute.evidence.map((item) => (
                  <li key={item.id} className="rounded-card border border-border p-3 text-sm">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-brand underline underline-offset-2"
                    >
                      {item.kind === 'photo' ? 'Photo' : 'Document'}
                    </a>
                    {item.note ? (
                      <p className="mt-1 text-xs text-text-secondary">{item.note}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-text-tertiary">Uploaded {at(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Investigation note</h3>
            <textarea
              className="min-h-20 w-full rounded-input border border-border-strong bg-card p-2.5 text-sm focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/40"
              value={noteText}
              onChange={(event) => onNoteText(event.target.value)}
              placeholder="What you checked, who you spoke to — stays internal until a resolution cites it."
              data-testid="dispute-note"
            />
            <Button
              className="mt-2"
              variant="outline"
              size="sm"
              onClick={onAddNote}
              disabled={isNoting || noteText.trim().length < 2}
              data-testid="dispute-note-submit"
            >
              {isNoting ? 'Saving…' : 'Add note'}
            </Button>
          </section>

          <ResolveDisputePanel
            openedFromStatus={dispute.openedFromStatus}
            isPending={isResolving}
            onResolve={onResolve}
          />
        </>
      )}

      <section>
        <NotesPanel subjectType="dispute" subjectId={dispute.id} />
      </section>
    </div>
  );
}
