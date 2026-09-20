'use client';

import { RelativeTime, humaniseStatus } from '@towing/web-ui';
import type { AdminSosEvent } from '@towing/api-contracts';

const KIND_LABEL: Record<AdminSosEvent['kind'], string> = {
  triggered: 'Alert raised',
  contacts_notified: 'Contacts notified',
  ops_alerted: 'Ops alerted',
  acknowledged: 'Acknowledged',
  contacted: 'Contact call opened',
  note: 'Note',
  broadcast: 'Nearest-driver broadcast',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

/**
 * §13's "full timeline" — every step of the incident's life, newest last so it
 * reads as a log. The actor column is why the server resolves admin names onto
 * the event: "Acknowledged" without "by Priya" is not a record of anything.
 */
export function SosTimeline({ events }: { events: AdminSosEvent[] }): React.ReactNode {
  if (events.length === 0) {
    return <p className="text-sm text-text-secondary">No events recorded yet.</p>;
  }

  return (
    <ol className="space-y-3" data-testid="sos-timeline">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span
            aria-hidden
            className={`mt-1 size-2 shrink-0 rounded-full ${
              event.kind === 'triggered' ? 'bg-sos' : 'bg-border-strong'
            }`}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{KIND_LABEL[event.kind]}</div>
            <div className="text-xs text-text-secondary">
              {event.actorName ??
                (event.actorType === 'system'
                  ? 'System'
                  : event.actorType === 'subject'
                    ? 'Requester'
                    : 'Admin')}{' '}
              · <RelativeTime at={event.createdAt} />
              {event.data?.duplicate === true ? ' · repeat tap' : ''}
            </div>
            {event.note ? (
              <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{event.note}</p>
            ) : null}
            {event.kind === 'broadcast' && typeof event.data?.drivers === 'number' ? (
              <p className="mt-1 text-xs text-text-secondary">
                {event.data.drivers} driver(s) within {String(event.data.radiusKm ?? '—')} km
              </p>
            ) : null}
            {event.kind === 'contacted' ? (
              <p className="mt-1 text-xs text-text-secondary">
                {event.data?.masked === true
                  ? 'Masked call opened'
                  : 'Direct dial (not masked — Exotel has no account yet)'}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Small helper shared by the detail page: human status text for chips. */
export function sosStatusLabel(status: string): string {
  return humaniseStatus(status);
}
