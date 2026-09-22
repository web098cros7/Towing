'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RelativeTime,
  Select,
  StatusChip,
  Textarea,
} from '@towing/web-ui';
import {
  SUPPORT_STATUS_TRANSITIONS,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  type AdminSupportTicketDetail,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from '@towing/api-contracts';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';
import { useToast } from '@/components/admin/ToastProvider';
import { ApiError } from '@/lib/apiClient';
import {
  useAssignTicket,
  useNoteTicket,
  useReplyTicket,
  useSetTicketStatus,
} from '../api/adminSupport.mutations';
import { useAdminSupportTicket } from '../api/adminSupport.queries';
import {
  SUPPORT_PRIORITY_LABEL,
  SUPPORT_STATUS_LABEL,
  SUPPORT_STATUS_TONE,
  requesterHref,
  slaState,
} from '../lib/supportSla';

/**
 * `/admin/support/[id]` — one thread (§9.4.12).
 *
 * THE PUBLIC/INTERNAL SPLIT IS THE WHOLE SCREEN, so it is the composer's only
 * mode switch: a reply notifies the requester and stops the first-response
 * clock, a note never leaves the console. They are two buttons on the same
 * textarea rather than one button plus a checkbox, because a mis-clicked
 * checkbox sends a customer something they were never meant to read.
 *
 * The priority select rides WITH the next status move — the backend's own
 * design ("this is now urgent" is the same decision as "this is now in
 * progress") and the reason this card is one workflow rather than two forms.
 */
export function SupportThread({ ticketId }: { ticketId: string }): React.ReactNode {
  const { data: ticket, isLoading, isError, error, refetch } = useAdminSupportTicket(ticketId);

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading ticket…</div>;
  }

  if (error instanceof ApiError && error.status === 403) {
    return <div className="text-sm text-error-soft-fg">You do not have access to tickets.</div>;
  }

  if (isError || !ticket) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-error-soft-fg">Could not load this ticket.</div>
        <Button variant="secondary" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return <ThreadBody ticket={ticket} />;
}

function ThreadBody({ ticket }: { ticket: AdminSupportTicketDetail }): React.ReactNode {
  const { admin } = useAdminIdentity();
  const toast = useToast();
  const assign = useAssignTicket(ticket.id);
  const setStatus = useSetTicketStatus(ticket.id);
  const reply = useReplyTicket(ticket.id);
  const note = useNoteTicket(ticket.id);

  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<SupportTicketPriority>(ticket.priority);

  const sla = slaState(ticket);
  const allowed = SUPPORT_STATUS_TRANSITIONS[ticket.status];
  const mine = admin !== null && ticket.assignedAdminId === admin.id;

  const send = (mode: 'reply' | 'note') => {
    const text = body.trim();
    if (text.length === 0) return;
    const callbacks = {
      onSuccess: () => {
        setBody('');
        toast(mode === 'reply' ? 'Reply sent to the requester' : 'Internal note saved', 'success');
      },
      onError: (cause: unknown) => toast(messageOf(cause), 'error'),
    };
    if (mode === 'reply') reply.mutate({ body: text }, callbacks);
    else note.mutate({ body: text }, callbacks);
  };

  const move = (status: SupportTicketStatus) => {
    setStatus.mutate(
      { status, priority: priority === ticket.priority ? undefined : priority },
      {
        onSuccess: () =>
          toast(
            priority === ticket.priority
              ? `Moved to ${SUPPORT_STATUS_LABEL[status]}`
              : `Moved to ${SUPPORT_STATUS_LABEL[status]} as ${SUPPORT_PRIORITY_LABEL[priority]}`,
            'success',
          ),
        onError: (cause) => toast(messageOf(cause), 'error'),
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{ticket.subject}</CardTitle>
                <div className="mt-1 font-mono text-xs text-text-secondary">{ticket.reference}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip
                  status={SUPPORT_STATUS_LABEL[ticket.status]}
                  tone={SUPPORT_STATUS_TONE[ticket.status]}
                />
                <Badge variant={ticket.priority === 'urgent' ? 'error' : 'neutral'}>
                  {SUPPORT_PRIORITY_LABEL[ticket.priority]}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-text-secondary">
            {sla.kind === 'awaiting' ? (
              sla.overdue ? (
                <span className="text-error-soft-fg" data-testid="support-overdue">
                  No response to the requester yet — overdue by{' '}
                  {Math.abs(sla.dueInHours).toFixed(1)}h
                </span>
              ) : (
                <span className="text-warning-soft-fg">
                  Awaiting first response (due in {sla.dueInHours.toFixed(1)}h)
                </span>
              )
            ) : sla.kind === 'answered' ? (
              <span>First response took {sla.hours.toFixed(1)}h</span>
            ) : (
              <span>This ticket is finished.</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ticket.messages.map((message) => (
              <div
                key={message.id}
                data-testid={
                  message.visibility === 'internal' ? 'support-internal-note' : undefined
                }
                className={
                  message.visibility === 'internal'
                    ? 'rounded-card border border-warning-soft-bg bg-warning-soft-bg/40 p-3'
                    : 'rounded-card border border-border p-3'
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {message.authorName ??
                      (message.authorType === 'admin' ? 'Support' : 'Requester')}
                  </div>
                  <div className="flex items-center gap-2">
                    {message.visibility === 'internal' ? (
                      <Badge variant="warning">Internal note — requester never sees this</Badge>
                    ) : null}
                    <RelativeTime at={message.createdAt} className="text-xs" />
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
                {message.attachments.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {message.attachments.map((url, i) => (
                      <a
                        key={`${message.id}-${i}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={url}
                          alt={`Attachment ${i + 1}`}
                          className="h-[72px] w-[72px] rounded-[8px] object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            <div className="space-y-2 rounded-card border border-border p-3">
              <Textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={3}
                placeholder="Write to the requester — or keep it internal…"
                data-testid="support-composer-body"
                aria-label="Message body"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  data-testid="support-send"
                  disabled={body.trim().length === 0 || reply.isPending}
                  onClick={() => send('reply')}
                >
                  Reply to requester
                </Button>
                <Button
                  variant="secondary"
                  data-testid="support-note"
                  disabled={body.trim().length === 0 || note.isPending}
                  onClick={() => send('note')}
                >
                  Save internal note
                </Button>
                <span className="text-xs text-text-secondary">
                  A reply notifies them; a note stays here.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Requester</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="font-semibold">{ticket.requesterName ?? 'Unknown'}</div>
            <div className="text-text-secondary">
              {ticket.requesterType === 'user'
                ? 'Customer'
                : ticket.requesterType === 'driver'
                  ? 'Driver'
                  : 'Fleet'}
              {ticket.requesterMobile ? ` · ${ticket.requesterMobile}` : ''}
            </div>
            <Link
              className="text-brand hover:underline"
              href={requesterHref(ticket)}
              data-testid="support-requester-link"
            >
              Open profile
            </Link>
            <div className="pt-2">
              {ticket.bookingId && ticket.bookingCode ? (
                <Link
                  className="text-brand hover:underline"
                  href={`/admin/bookings/${ticket.bookingId}`}
                  data-testid="support-booking-link"
                >
                  Booking {ticket.bookingCode}
                </Link>
              ) : (
                <span className="text-xs text-text-tertiary">No booking linked</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                data-testid="support-assign"
                disabled={mine || assign.isPending}
                onClick={() =>
                  assign.mutate(
                    {},
                    {
                      onSuccess: () => toast('Ticket assigned to you', 'success'),
                      onError: (cause) => toast(messageOf(cause), 'error'),
                    },
                  )
                }
              >
                {mine ? 'Assigned to you' : 'Assign to me'}
              </Button>
              <span className="text-xs text-text-secondary">
                {ticket.assignedAdminName
                  ? `With ${ticket.assignedAdminName}`
                  : 'Nobody owns this yet'}
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold" htmlFor="support-priority">
                Priority
              </label>
              <Select
                id="support-priority"
                className="w-full"
                value={priority}
                onChange={(event) => setPriority(event.target.value as SupportTicketPriority)}
                data-testid="support-priority"
              >
                {SUPPORT_TICKET_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {SUPPORT_PRIORITY_LABEL[value]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-text-secondary">
                A priority change rides with the next status move.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {SUPPORT_TICKET_STATUSES.filter((status) => status !== ticket.status).map(
                (status) => {
                  const legal = allowed.includes(status);
                  return (
                    <Button
                      key={status}
                      size="sm"
                      variant={status === 'resolved' ? 'primary' : 'secondary'}
                      disabled={!legal || setStatus.isPending}
                      data-testid={`support-status-${status}`}
                      onClick={() => move(status)}
                    >
                      {SUPPORT_STATUS_LABEL[status]}
                    </Button>
                  );
                },
              )}
            </div>
            {ticket.status === 'closed' ? (
              <p className="text-xs text-text-secondary">
                Closed is final — a requester who answers starts a new ticket.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-text-secondary">
            {ticket.events.map((event) => (
              <div key={event.id} className="flex items-start justify-between gap-2">
                <span>
                  {event.kind === 'status_changed' && typeof event.data?.to === 'string'
                    ? `Status → ${SUPPORT_STATUS_LABEL[event.data.to as SupportTicketStatus]}`
                    : EVENT_LABEL[event.kind]}
                  {event.actorName ? ` · ${event.actorName}` : ''}
                </span>
                <RelativeTime at={event.createdAt} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<AdminSupportTicketDetail['events'][number]['kind'], string> = {
  created: 'Created',
  assigned: 'Assigned',
  status_changed: 'Status changed',
  message: 'Public reply',
  note: 'Internal note',
  linked_booking: 'Booking linked',
};

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
