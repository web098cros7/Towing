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
} from '@towing/web-ui';
import type { AdminPayoutDto } from '@towing/api-contracts';
import { formatPaise } from '@/lib/money';
import { useApprovePayout, useRejectPayout } from '../api/adminFinance.mutations';

/**
 * §9.4.10's decision, following `DriverKycDrawer`'s shape.
 *
 * REJECTION REQUIRES A REASON; APPROVAL DOES NOT — the same asymmetry the KYC
 * drawer uses, and for the same reason: approval is the expected outcome, while
 * a rejection is something somebody will have to explain later, to the driver
 * whose money it is and to whoever reads `admin_actions`.
 *
 * WHAT AN APPROVAL ACTUALLY DOES, spelled out on the screen: the wallet was
 * debited when the payout was REQUESTED, so approving does not take the money —
 * it sends it. An operator who thinks approval is what debits the driver will
 * reason wrongly about a rejection, which returns the funds with a compensating
 * §14.5 entry rather than deleting the debit.
 */
export function PayoutDecisionDrawer({
  payout,
  onClose,
}: {
  payout: AdminPayoutDto | null;
  onClose: () => void;
}) {
  const approve = useApprovePayout();
  const reject = useRejectPayout();

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (!payout) return null;

  const busy = approve.isPending || reject.isPending;
  const decidable = payout.approvalState === 'pending_approval';
  const error = (approve.error ?? reject.error) as Error | null;

  const close = () => {
    setRejecting(false);
    setReason('');
    approve.reset();
    reject.reset();
    onClose();
  };

  return (
    <Dialog open onClose={close} labelledBy="payout-decision-title">
      <DialogHeader>
        <DialogTitle id="payout-decision-title">
          {formatPaise(payout.amountPaise)} to {payout.ownerName ?? 'this payee'}
        </DialogTitle>
      </DialogHeader>

      <DialogBody>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-text-secondary">Payee</dt>
          <dd className="capitalize">
            {payout.ownerType} · {payout.ownerName ?? 'Unnamed'}
          </dd>

          <dt className="text-text-secondary">Destination</dt>
          <dd className="tabular-nums">
            {payout.destinationLast4
              ? `${payout.bankName ?? 'Bank account'} •••• ${payout.destinationLast4}`
              : 'Not linked'}
          </dd>

          <dt className="text-text-secondary">Requested</dt>
          <dd>{new Date(payout.requestedAt).toLocaleString('en-IN')}</dd>

          <dt className="text-text-secondary">Vendor status</dt>
          <dd>
            {/*
              TWO SEPARATE AXES, shown separately on purpose. `status` is §5.5's
              vendor lifecycle; `approvalState` is §14.4's internal gate. A
              payout awaiting approval is `requested` because no vendor has been
              told about it yet — collapsing the two into one chip is how an
              operator concludes the provider is slow when nobody has sent it.
            */}
            <Badge variant="neutral">{payout.status}</Badge>
          </dd>

          <dt className="text-text-secondary">Approval</dt>
          <dd>
            <Badge variant={payout.approvalState === 'rejected' ? 'error' : 'warning'}>
              {payout.approvalState.replace(/_/g, ' ')}
            </Badge>
          </dd>

          {payout.rejectionReason ? (
            <>
              <dt className="text-text-secondary">Reason</dt>
              <dd>{payout.rejectionReason}</dd>
            </>
          ) : null}
        </dl>

        {decidable ? (
          <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">
            The payee&apos;s wallet was already debited when they requested this. Approving sends the
            money to their bank; rejecting returns it to their wallet with a compensating entry.
          </p>
        ) : null}

        {rejecting ? (
          <div className="mt-4">
            <label htmlFor="payout-reject-reason" className="text-sm font-medium">
              Why are you rejecting this?
            </label>
            <textarea
              id="payout-reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              data-testid="finance-reject-reason"
              className="mt-1 w-full rounded-lg border border-border p-2 text-sm"
              placeholder="The payee sees this, so make it actionable."
            />
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-error">{error.message}</p> : null}
      </DialogBody>

      <DialogFooter>
        {decidable ? (
          rejecting ? (
            <>
              <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
                Back
              </Button>
              <Button
                variant="destructive"
                data-testid="finance-confirm-reject"
                // Five characters is the contract's own minimum. Client-side so
                // the operator is told before they submit, never instead of the
                // server checking.
                disabled={busy || reason.trim().length < 5}
                onClick={() =>
                  reject.mutate({ payoutId: payout.id, reason: reason.trim() }, { onSuccess: close })
                }
              >
                {reject.isPending ? 'Rejecting…' : 'Confirm rejection'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                data-testid="finance-decide-reject"
                onClick={() => setRejecting(true)}
                disabled={busy}
              >
                Reject
              </Button>
              <Button
                data-testid="finance-decide-approve"
                onClick={() => approve.mutate(payout.id, { onSuccess: close })}
                disabled={busy}
              >
                {approve.isPending ? 'Approving…' : 'Approve and send'}
              </Button>
            </>
          )
        ) : (
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
