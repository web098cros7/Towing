'use client';

import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RelativeTime,
  Skeleton,
  StatusChip,
  type StatusTone,
} from '@towing/web-ui';
import type { AdminSosContact, AdminSosDetail, SosStatus } from '@towing/api-contracts';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminSosDetail } from '../api/adminSos.queries';
import { SosActions } from './SosActions';
import { SosTimeline } from './SosTimeline';

const STATUS_TONE: Record<SosStatus, StatusTone> = {
  triggered: 'error',
  acknowledged: 'warning',
  resolved: 'success',
  cancelled: 'neutral',
};

const SOURCE_LABEL: Record<AdminSosDetail['source'], string> = {
  app: 'Raised from the app',
  ops: 'Raised by ops (phone call)',
  sms_fallback: 'Raised by SMS fallback',
};

/**
 * `/admin/sos/[id]` — one incident's whole life (§13): where it came from, who
 * the snapshot says to reach, what has happened, and the workflow actions.
 *
 * The DESIRED DEGRADATION IS STATED HERE, not buried: SMS cannot send until
 * the DLT registration lands, WhatsApp awaits template approval, and a masked
 * call falls back to the real number until Exotel is configured. An operator
 * who assumes a contact was reached is worse off than one who knows they must
 * still telephone.
 */
export function SosDetail({ alertId }: { alertId: string }): React.ReactNode {
  const { data, isLoading, isError, error, refetch } = useAdminSosDetail(alertId);

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div>
        <PageHeader title="SOS incident" description="One incident, every step." />
        <AdminForbidden resource="this incident" />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="SOS incident" description="One incident, every step." />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="SOS incident" description="One incident, every step." />
        <button className="text-sm text-error underline" onClick={() => void refetch()}>
          Could not load this incident — retry
        </button>
      </div>
    );
  }

  const mapHref = `https://maps.google.com/?q=${data.lat},${data.lng}`;

  return (
    <div>
      <PageHeader
        title={`${data.subjectName ?? 'Unknown subject'} — ${data.subjectType === 'user' ? 'customer' : 'driver'}`}
        description={`${SOURCE_LABEL[data.source]} · raised ${new Date(data.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}
        actions={
          <Link href="/admin/sos" className="text-sm text-brand underline">
            ← Back to the queue
          </Link>
        }
      />

      {data.status === 'triggered' ? (
        <div
          className="mb-4 rounded-card border-2 border-sos bg-error-soft-bg px-4 py-3 text-sm font-semibold text-error-soft-fg"
          data-testid="sos-unacknowledged"
        >
          Unacknowledged — acknowledge before anything else so the queue knows it is being worked.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Incident</CardTitle>
              <StatusChip status={data.status} tone={STATUS_TONE[data.status]} />
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-text-secondary">Status</dt>
                  <dd className="font-semibold capitalize">{data.status}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Acknowledged</dt>
                  <dd>
                    {data.acknowledgedAt ? (
                      <>
                        <RelativeTime at={data.acknowledgedAt} />
                        {data.acknowledgedByName ? ` by ${data.acknowledgedByName}` : ''}
                        {data.ackSeconds !== null ? ` (${data.ackSeconds}s)` : ''}
                      </>
                    ) : (
                      <span className="text-warning">Not acknowledged</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Location</dt>
                  <dd>
                    <a
                      href={mapHref}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand underline"
                      data-testid="sos-map-link"
                    >
                      {data.lat.toFixed(5)}, {data.lng.toFixed(5)}
                    </a>
                    {data.accuracyM !== null ? (
                      <span className="text-text-secondary"> ±{Math.round(data.accuracyM)} m</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Booking</dt>
                  <dd>
                    {data.bookingId ? (
                      <Link
                        href={`/admin/bookings/${data.bookingId}`}
                        className="font-mono text-xs text-brand underline"
                      >
                        {data.bookingCode ?? data.bookingId}
                      </Link>
                    ) : (
                      <span className="text-text-tertiary">Standalone (no active booking)</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Resolution</dt>
                  <dd>{data.resolution ?? <span className="text-text-tertiary">—</span>}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Subject mobile</dt>
                  <dd className="font-mono text-xs">{data.subjectMobile ?? '—'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <SosTimeline events={data.events} />
            </CardContent>
          </Card>

          <SosActions detail={data} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Emergency contacts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="rounded-card border border-warning bg-warning-soft-bg px-3 py-2 text-xs text-warning-soft-fg">
                SMS cannot send until the MSG91/DLT registration lands and WhatsApp awaits template
                approval — so these notifications are the DESIGNED degradation, not a delivery.
                Telephone the contact.
              </p>
              {data.contacts.length === 0 ? (
                <p className="text-sm text-text-secondary">
                  No emergency contacts on file for this subject — ops is the only alert path.
                </p>
              ) : (
                <ul className="space-y-3" data-testid="sos-contacts">
                  {data.contacts.map((contact) => (
                    <ContactRow key={contact.id} contact={contact} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ContactRow({ contact }: { contact: AdminSosContact }): React.ReactNode {
  return (
    <li className="rounded-card border border-border px-3 py-2">
      <div className="text-sm font-semibold">
        {contact.name}
        {contact.relation ? (
          <span className="text-text-secondary"> · {contact.relation}</span>
        ) : null}
      </div>
      <div className="font-mono text-xs text-text-secondary">{contact.phone}</div>
      <div className="mt-1 flex flex-wrap gap-2 text-xs">
        {contact.notifiedChannels.map((result) => (
          <span
            key={result.channel}
            className={result.ok ? 'text-success' : 'text-warning'}
            title={result.code ?? undefined}
          >
            {result.channel.toUpperCase()}: {result.ok ? 'queued' : `blocked (${result.code})`}
          </span>
        ))}
      </div>
    </li>
  );
}
