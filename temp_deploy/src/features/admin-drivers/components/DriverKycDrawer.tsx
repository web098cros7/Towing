'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
} from '@towing/web-ui';
import { useDecideKyc, useReviewDocument, useUpdateDriverCapabilities } from '../api/adminDrivers.mutations';
import { DOC_TYPE_LABEL, type AdminPendingDriver, type DocReviewStatus } from '../types';

const DOC_STATUS_VARIANT: Record<DocReviewStatus, 'success' | 'warning' | 'error'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'error',
};

/** Which overall decision the driver-level reason prompt is currently open for. */
type PendingDecision = 'reject' | 'request_info' | null;

export function DriverKycDrawer({
  driver,
  onClose,
}: {
  driver: AdminPendingDriver | null;
  onClose: () => void;
}) {
  const decideKyc = useDecideKyc();
  const reviewDocument = useReviewDocument();
  const updateCapabilities = useUpdateDriverCapabilities();

  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
  const [reason, setReason] = useState('');
  const [docReasonFor, setDocReasonFor] = useState<string | null>(null);
  const [docReason, setDocReason] = useState('');

  if (!driver) return null;

  const busy = decideKyc.isPending || reviewDocument.isPending || updateCapabilities.isPending;

  const submitDecision = (decision: 'approve' | 'reject' | 'request_info', withReason?: string) => {
    decideKyc.mutate(
      { driverId: driver.id, decision, reason: withReason },
      {
        onSuccess: () => {
          setPendingDecision(null);
          setReason('');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={driver !== null} onClose={onClose} labelledBy="kyc-drawer-title" className="w-[min(40rem,calc(100vw-2rem))]">
      <DialogHeader>
        <DialogTitle id="kyc-drawer-title">{driver.name ?? 'Unnamed driver'}</DialogTitle>
        <p className="text-sm text-text-secondary">{driver.mobile}</p>
      </DialogHeader>

      <DialogBody>
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

        <div className="flex flex-col gap-3">
          {driver.documents.map((doc) => (
            <div key={doc.id} className="flex items-start gap-3 rounded-card border border-border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-TTL URL; not a static asset Next can optimize */}
              <img
                src={doc.thumbnailUrl}
                alt={`${DOC_TYPE_LABEL[doc.docType]} document`}
                className="size-16 shrink-0 rounded-md border border-border object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{DOC_TYPE_LABEL[doc.docType]}</span>
                  <Badge variant={DOC_STATUS_VARIANT[doc.status]}>{doc.status}</Badge>
                </div>
                {doc.rejectionReason ? (
                  <p className="mt-1 text-xs text-error">{doc.rejectionReason}</p>
                ) : null}

                {docReasonFor === doc.id ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      className="w-full rounded-md border border-border bg-transparent p-2 text-xs"
                      rows={2}
                      placeholder="Why is this document rejected?"
                      value={docReason}
                      onChange={(e) => setDocReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={docReason.trim().length < 3 || reviewDocument.isPending}
                        onClick={() =>
                          reviewDocument.mutate(
                            { driverId: driver.id, documentId: doc.id, decision: 'reject', reason: docReason },
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
                        reviewDocument.mutate({ driverId: driver.id, documentId: doc.id, decision: 'approve' })
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
          ))}
        </div>

        {pendingDecision ? (
          <div className="flex flex-col gap-2 rounded-card border border-border p-3">
            <label className="text-xs font-medium text-text-secondary" htmlFor="overall-reason">
              {pendingDecision === 'reject' ? 'Rejection reason' : 'What do you need from the driver?'}
            </label>
            <textarea
              id="overall-reason"
              className="w-full rounded-md border border-border bg-transparent p-2 text-sm"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter>
        {pendingDecision ? (
          <>
            <Button variant="ghost" onClick={() => setPendingDecision(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || busy}
              onClick={() => submitDecision(pendingDecision, reason)}
            >
              {pendingDecision === 'reject' ? 'Confirm reject' : 'Send request'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
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
              variant="destructive"
              disabled={busy}
              onClick={() => setPendingDecision('reject')}
              data-testid="kyc-decide-reject"
            >
              Reject
            </Button>
            <Button disabled={busy} onClick={() => submitDecision('approve')} data-testid="kyc-decide-approve">
              Approve
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
