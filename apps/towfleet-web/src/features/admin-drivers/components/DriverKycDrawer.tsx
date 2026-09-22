'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Input,
  RelativeTime,
  Select,
  Switch,
  Textarea,
} from '@towing/web-ui';
import { useAdminAuditFeed } from '@/features/admin-audit/api/adminAudit.queries';
import { AdminLiveMap } from '@/features/admin-ops/components/AdminLiveMap';
import { NotesPanel } from '@/features/admin-notes/components/NotesPanel';
import { useAdminDocumentVersions, useAdminPendingDrivers } from '../api/adminDrivers.queries';
import {
  useDecideKyc,
  useReviewDocument,
  useUpdateDriverCapabilities,
} from '../api/adminDrivers.mutations';
import { DOC_TYPE_LABEL, type AdminDocumentVersion, type AdminPendingDriver, type DocReviewStatus } from '../types';
import { DocumentViewer } from './DocumentViewer';

const DOC_STATUS_VARIANT: Record<DocReviewStatus, 'success' | 'warning' | 'error'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'error',
};

/** Which overall decision the driver-level reason prompt is currently open for. */
type PendingDecision = 'reject' | 'request_info' | 'suspend' | null;

/** The document the zoomable viewer is showing. */
type ViewerTarget = { src: string; title: string; caption?: string | null } | null;

/**
 * The KYC review drawer (Phase 11, finished by W7).
 *
 * A19: the drawer takes an id and derives a LIVE row from the queue query —
 * never the clicked snapshot. Toggling a capability, reviewing a document or
 * refetching the queue updates what is on screen; a row that leaves the queue
 * unmounts the drawer (the parent mounts conditionally on the derived row).
 *
 * W7 added: the shared `Drawer` (it was the last hand-rolled one), the zoomable
 * viewer, per-document version history, the decision history from the
 * subject-scoped audit feed, Suspend/Reactivate, and the "GPS on map" section —
 * shipped as the driver's LAST KNOWN location and labelled that way, because no
 * document carries capture-time coordinates.
 */
export function DriverKycDrawer({
  driverId,
  page,
  onClose,
  onSuspended,
}: {
  driverId: string;
  /** The queue page this drawer was opened from — the live row comes from its cache. */
  page: number;
  onClose: () => void;
  /** The row left the queue mid-review; the page keeps this drawer mounted for the undo. */
  onSuspended: () => void;
}) {
  const { data } = useAdminPendingDrivers(page);
  const liveDriver = data?.items.find((row) => row.id === driverId) ?? null;

  /**
   * A suspension removes the row from the queue (it is pending-only), so the
   * live row disappears the moment the refetch lands — and with it the undo.
   * Holding the row keeps the drawer, and the Reactivate button, on screen
   * until the operator closes it.
   */
  const [suspendedRow, setSuspendedRow] = useState<AdminPendingDriver | null>(null);
  const driver = liveDriver ?? suspendedRow;

  const versions = useAdminDocumentVersions(driverId);
  const history = useAdminAuditFeed({ subjectType: 'driver', subjectId: driverId, limit: 10 });

  const decideKyc = useDecideKyc();
  const reviewDocument = useReviewDocument();
  const updateCapabilities = useUpdateDriverCapabilities();

  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
  const [suspendMode, setSuspendMode] = useState<'after_current_job' | 'immediate'>(
    'after_current_job',
  );
  const [reason, setReason] = useState('');
  /**
   * The name as printed on the licence. `null` means "the operator has not
   * touched this", and the field then MIRRORS the account name — it is not
   * seeded into state, because the driver row arrives from a query that has
   * not resolved on first render, and a `useState` initial value read then
   * would latch an empty string and never catch up.
   */
  const [licenceNameEdit, setLicenceNameEdit] = useState<string | null>(null);
  const [docReasonFor, setDocReasonFor] = useState<string | null>(null);
  const [docReason, setDocReason] = useState('');
  const [viewer, setViewer] = useState<ViewerTarget>(null);
  /**
   * A14's reactivate has no entry point in the QUEUE — it lists `pending`
   * drivers only, so a suspended driver is never a row here. It is reachable
   * where it is actually needed: as the undo for a suspension just recorded a
   * second ago in this drawer.
   */
  const [suspendedJustNow, setSuspendedJustNow] = useState(false);

  /** Every recorded upload, grouped by document type — the panel under each card. */
  const versionsByType = useMemo(() => {
    const grouped = new Map<string, AdminDocumentVersion[]>();
    for (const version of versions.data ?? []) {
      const list = grouped.get(version.docType) ?? [];
      list.push(version);
      grouped.set(version.docType, list);
    }
    return grouped;
  }, [versions.data]);

  const auditEntries = useMemo(
    () => (history.data?.pages ?? []).flatMap((pageData) => pageData.entries),
    [history.data],
  );

  if (!driver) return null;

  const busy = decideKyc.isPending || reviewDocument.isPending || updateCapabilities.isPending;
  // Mutation failures render inline (A19) — a refused decision must say why
  // instead of just unsticking the button. First failure wins; a retry clears.
  const error =
    (decideKyc.error as Error | null) ??
    (reviewDocument.error as Error | null) ??
    (updateCapabilities.error as Error | null) ??
    null;

  const close = () => {
    setPendingDecision(null);
    setReason('');
    setLicenceNameEdit(null);
    setDocReasonFor(null);
    setDocReason('');
    setViewer(null);
    decideKyc.reset();
    reviewDocument.reset();
    updateCapabilities.reset();
    onClose();
  };

  const submitDecision = (
    decision: 'approve' | 'reject' | 'request_info' | 'suspend' | 'reactivate',
    withReason?: string,
    mode?: 'after_current_job' | 'immediate',
  ) => {
    decideKyc.mutate(
      {
        driverId: driver.id,
        decision,
        reason: withReason,
        mode,
        // Only on approval, and only when it actually says something: an empty
        // box must not blank a driver's name.
        licenceName: decision === 'approve' ? licenceName.trim() || undefined : undefined,
      },
      {
        onSuccess: (result) => {
          if (decision === 'suspend') {
            // Keep the drawer open with an undo instead of closing under the
            // operator's cursor: a mis-clicked suspension is otherwise a trip
            // to the drivers directory to reverse.
            setSuspendedRow(liveDriver);
            setSuspendedJustNow(true);
            setPendingDecision(null);
            setReason('');
            onSuspended();
            return;
          }
          close();
        },
      },
    );
  };

  const location = driver.lastKnownLocation;

  /** What the licence-name box shows: the operator's edit, else the account name. */
  const licenceName = licenceNameEdit ?? driver.name ?? '';

  return (
    <Drawer open onClose={close} labelledBy="kyc-drawer-title">
      <DrawerHeader>
        <DrawerTitle id="kyc-drawer-title">{driver.name ?? 'Unnamed driver'}</DrawerTitle>
        <p className="text-sm text-text-secondary">{driver.mobile}</p>
        <p className="text-xs text-text-tertiary">
          Submitted <RelativeTime at={driver.kycSubmittedAt} /> ·{' '}
          {driver.documents.length} documents
        </p>
      </DrawerHeader>

      <DrawerBody>
        {suspendedJustNow ? (
          <div
            className="rounded-card border border-warning/40 bg-warning/10 p-3 text-sm"
            data-testid="kyc-suspended-note"
          >
            Suspension recorded for {driver.name ?? 'this driver'}. Their sessions and devices were
            revoked and they are out of the dispatch pool.
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-card border border-border p-3">
          <div>
            <div className="text-sm font-medium">Long-distance (Band C) opt-in</div>
            <p className="text-xs text-text-secondary">§3.2 — admin can revoke this at any time.</p>
          </div>
          <Switch
            checked={driver.longDistanceEnabled}
            disabled={updateCapabilities.isPending}
            labelledBy="kyc-drawer-title"
            onCheckedChange={(checked) =>
              updateCapabilities.mutate({
                driverId: driver.id,
                input: { longDistanceEnabled: checked },
              })
            }
          />
        </div>

        {/* W7: "GPS on map", as the last known position it actually is. */}
        <div className="rounded-card border border-border p-3" data-testid="kyc-location">
          <div className="mb-2 text-sm font-medium">Last known location</div>
          {location ? (
            <>
              <div className="h-[200px] overflow-hidden rounded-md border border-border">
                <AdminLiveMap
                  drivers={[
                    {
                      driverId: driver.id,
                      name: driver.name,
                      zoneId: null,
                      lat: location.lat,
                      lng: location.lng,
                      headingDeg: null,
                      speedKph: null,
                      at: location.at,
                      fromFallback: false,
                      dispatchable: true,
                    },
                  ]}
                  bookings={[]}
                  zones={[]}
                  selectedDriverId={driver.id}
                  selectedBookingId={null}
                  onSelect={() => undefined}
                />
              </div>
              <p className="mt-2 text-xs text-text-tertiary">
                {location.lat.toFixed(4)}, {location.lng.toFixed(4)} · last ping{' '}
                <RelativeTime at={location.at} />. This is where they were last seen, not a live
                position.
              </p>
            </>
          ) : (
            <p className="text-xs text-text-tertiary" data-testid="kyc-location-none">
              No last known location — this driver has never pinged from the app.
            </p>
          )}
        </div>

        {error ? (
          <p data-testid="kyc-error" className="text-sm text-error">
            {error.message}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          {driver.documents.map((doc) => {
            const docVersions = versionsByType.get(doc.docType) ?? [];
            const superseded = docVersions.filter((version) => version.supersededAt !== null);
            return (
              <div
                key={doc.id}
                className="flex flex-col gap-3 rounded-card border border-border p-3"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-brand"
                    title="Open the zoomable viewer"
                    data-testid={`kyc-zoom-${doc.id}`}
                    onClick={() =>
                      setViewer({
                        src: doc.thumbnailUrl,
                        title: `${DOC_TYPE_LABEL[doc.docType]} — ${driver.name ?? 'driver'}`,
                        caption: doc.rejectionReason
                          ? `Rejected: ${doc.rejectionReason}`
                          : 'Click the image to zoom. The signed link expires — reopen the row if it stops loading.',
                      })
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-TTL URL; not a static asset Next can optimize */}
                    <img
                      src={doc.thumbnailUrl}
                      alt={`${DOC_TYPE_LABEL[doc.docType]} document`}
                      className="size-16 rounded-md border border-border object-cover"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{DOC_TYPE_LABEL[doc.docType]}</span>
                      <Badge variant={DOC_STATUS_VARIANT[doc.status]}>{doc.status}</Badge>
                      {superseded.length > 0 ? (
                        <span className="text-xs text-text-tertiary">
                          {superseded.length} earlier {superseded.length === 1 ? 'upload' : 'uploads'}
                        </span>
                      ) : null}
                    </div>
                    {doc.rejectionReason ? (
                      <p className="mt-1 text-xs text-error">{doc.rejectionReason}</p>
                    ) : null}

                    {docReasonFor === doc.id ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <Textarea
                          className="text-xs"
                          rows={2}
                          placeholder="Why is this document rejected?"
                          value={docReason}
                          onChange={(event) => setDocReason(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={docReason.trim().length < 3 || reviewDocument.isPending}
                            onClick={() =>
                              reviewDocument.mutate(
                                {
                                  driverId: driver.id,
                                  documentId: doc.id,
                                  decision: 'reject',
                                  reason: docReason,
                                },
                                { onSuccess: () => setDocReasonFor(null) },
                              )
                            }
                          >
                            Confirm reject
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDocReasonFor(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={doc.status === 'approved' || reviewDocument.isPending}
                          onClick={() =>
                            reviewDocument.mutate({
                              driverId: driver.id,
                              documentId: doc.id,
                              decision: 'approve',
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={doc.status === 'rejected' || reviewDocument.isPending}
                          onClick={() => {
                            setDocReasonFor(doc.id);
                            setDocReason('');
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* W7: the history a resubmission used to destroy. */}
                {docVersions.length > 0 ? (
                  <details className="border-t border-border pt-2" data-testid="kyc-versions">
                    <summary className="cursor-pointer text-xs text-text-secondary">
                      Upload history ({docVersions.length})
                    </summary>
                    <ul className="mt-2 flex flex-col gap-2">
                      {docVersions.map((version) => (
                        <li key={version.id} className="flex items-start gap-2 text-xs">
                          <button
                            type="button"
                            className="shrink-0 rounded focus-visible:ring-2 focus-visible:ring-brand"
                            onClick={() =>
                              setViewer({
                                src: version.thumbnailUrl,
                                title: `${DOC_TYPE_LABEL[version.docType]} — upload of ${new Date(version.createdAt).toLocaleString('en-IN')}`,
                                caption: version.supersededAt
                                  ? `Replaced by a later upload on ${new Date(version.supersededAt).toLocaleString('en-IN')}.`
                                  : 'The file currently on review.',
                              })
                            }
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-TTL URL; not a static asset Next can optimize */}
                            <img
                              src={version.thumbnailUrl}
                              alt=""
                              className="size-10 rounded border border-border object-cover"
                            />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={DOC_STATUS_VARIANT[version.status]}>
                                {version.status}
                              </Badge>
                              <span className="text-text-secondary">
                                uploaded <RelativeTime at={version.createdAt} />
                              </span>
                              {version.supersededAt ? (
                                <span className="text-text-tertiary">
                                  · replaced <RelativeTime at={version.supersededAt} />
                                </span>
                              ) : (
                                <span className="text-text-tertiary">· current</span>
                              )}
                            </div>
                            {version.verifiedAt ? (
                              <p className="text-text-tertiary">
                                Reviewed <RelativeTime at={version.verifiedAt} />
                                {version.verifiedBy
                                  ? ` by ${version.verifiedBy.slice(0, 8)}`
                                  : ''}
                              </p>
                            ) : null}
                            {version.rejectionReason ? (
                              <p className="text-error">{version.rejectionReason}</p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* W7: decision history, straight off the subject-scoped audit feed —
            the same rows the audit viewer shows for this driver. */}
        <div className="border-t border-border pt-4" data-testid="kyc-history">
          <div className="mb-2 text-sm font-medium">Decision history</div>
          {history.isLoading ? (
            <p className="text-xs text-text-tertiary">Loading…</p>
          ) : auditEntries.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              No decisions recorded yet — this driver has not been reviewed or suspended.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {auditEntries.map((entry) => (
                <li key={entry.id} className="text-xs">
                  <span className="font-medium">{entry.action}</span>
                  <span className="text-text-tertiary">
                    {' '}
                    · <RelativeTime at={entry.createdAt} /> · admin {entry.adminId.slice(0, 8)}
                  </span>
                  {entry.reason ? <p className="text-text-secondary">“{entry.reason}”</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* W21: the same panel drops into every detail screen. */}
        <div className="border-t border-border pt-4">
          <NotesPanel subjectType="driver" subjectId={driver.id} />
        </div>

        {/*
          The one place the platform reads a driver's name off their licence.
          Drivers cannot edit their own name, and the fleet's invite is only a
          guess — so until this field existed, "the name comes from the licence"
          was a rule nothing enforced. Shown while a decision is still open, and
          only then: after the verdict there is nothing left to correct here.
        */}
        {!pendingDecision && !suspendedJustNow ? (
          <div className="flex flex-col gap-2 rounded-card border border-border p-3">
            <label className="text-xs font-medium text-text-secondary" htmlFor="licence-name">
              Name on the licence
            </label>
            <Input
              id="licence-name"
              data-testid="kyc-licence-name"
              value={licenceName}
              onChange={(event) => setLicenceNameEdit(event.target.value)}
            />
            <p className="text-xs text-text-tertiary">
              Type it exactly as printed. Approving saves it to the driver&apos;s account, replacing
              the name their fleet entered.
            </p>
          </div>
        ) : null}

        {pendingDecision ? (
          <div className="flex flex-col gap-2 rounded-card border border-border p-3">
            <label className="text-xs font-medium text-text-secondary" htmlFor="overall-reason">
              {pendingDecision === 'reject'
                ? 'Rejection reason'
                : pendingDecision === 'suspend'
                  ? 'Suspension reason'
                  : 'What do you need from the driver?'}
            </label>
            <Textarea
              id="overall-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {pendingDecision === 'suspend' ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-secondary" htmlFor="suspend-mode">
                  When (A14)
                </label>
                <Select
                  id="suspend-mode"
                  data-testid="kyc-suspend-mode"
                  value={suspendMode}
                  onChange={(event) =>
                    setSuspendMode(event.target.value as 'after_current_job' | 'immediate')
                  }
                >
                  <option value="after_current_job">After the current job</option>
                  <option value="immediate">Immediately</option>
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}
      </DrawerBody>

      <DrawerFooter className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        {suspendedJustNow ? (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Close
            </Button>
            <Button
              disabled={busy}
              onClick={() => submitDecision('reactivate')}
              data-testid="kyc-decide-reactivate"
            >
              Reactivate
            </Button>
          </>
        ) : pendingDecision ? (
          <>
            <Button variant="ghost" onClick={() => setPendingDecision(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || busy}
              data-testid="kyc-confirm-decision"
              onClick={() => submitDecision(pendingDecision, reason, pendingDecision === 'suspend' ? suspendMode : undefined)}
            >
              {pendingDecision === 'reject'
                ? 'Confirm reject'
                : pendingDecision === 'suspend'
                  ? 'Confirm suspend'
                  : 'Send request'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPendingDecision('request_info')}
              data-testid="kyc-decide-request-info"
            >
              Request info
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPendingDecision('suspend');
                setReason('');
                setSuspendMode('after_current_job');
              }}
              data-testid="kyc-decide-suspend"
            >
              Suspend
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => setPendingDecision('reject')}
              data-testid="kyc-decide-reject"
            >
              Reject
            </Button>
            <Button
              disabled={busy}
              onClick={() => submitDecision('approve')}
              data-testid="kyc-decide-approve"
            >
              Approve
            </Button>
          </>
        )}
      </DrawerFooter>

      <DocumentViewer
        open={viewer !== null}
        onClose={() => setViewer(null)}
        src={viewer?.src ?? ''}
        title={viewer?.title ?? ''}
        caption={viewer?.caption}
      />
    </Drawer>
  );
}
