'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  Textarea,
} from '@towing/web-ui';
import { ADMIN_TRANSITION_EDGES, type AdminBookingTransitionBody, type JobStatus } from '@towing/api-contracts';

/**
 * §9.4.7's manual override — the super-admin escape hatch, and deliberately
 * the narrowest surface in the console.
 *
 * The target list is `ADMIN_TRANSITION_EDGES` filtered to the booking's
 * CURRENT status: an override jumps along a legal edge, it does not invent
 * one. Nothing here can reach `paid` (settlement owns that status), and
 * `in_progress → completed` runs the REAL completion service — §7.4's waiting
 * charge bills from the booking's snapshot, so an override is not a way to
 * skip the money.
 */
export function BookingOverrideDialog({
  open,
  onClose,
  bookingCode,
  currentStatus,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  bookingCode: string;
  currentStatus: JobStatus;
  isPending: boolean;
  onConfirm: (body: AdminBookingTransitionBody) => Promise<unknown>;
}) {
  const targets = ADMIN_TRANSITION_EDGES.filter((edge) => edge.from === currentStatus).map(
    (edge) => edge.to,
  );

  const [to, setTo] = useState<JobStatus | ''>('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTo(targets.length === 1 ? (targets[0] ?? '') : '');
      setReason('');
      setPending(false);
      setErrorMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `targets` derives
    // from `currentStatus`, which is frozen while the dialog is open.
  }, [open]);

  const ready = to !== '' && reason.trim().length >= 4;
  const busy = pending || isPending;

  const submit = async () => {
    if (!ready || busy) return;
    setPending(true);
    setErrorMessage(null);
    try {
      await onConfirm({ to: to as JobStatus, reason: reason.trim() });
      onClose();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="booking-override-title">
      <DialogHeader>
        <DialogTitle id="booking-override-title">Override {bookingCode}</DialogTitle>
        <p className="text-sm text-text-secondary">
          Moves the booking one legal step from <strong>{currentStatus}</strong>. Settlement is the
          only path to <strong>paid</strong> — it is not offered here.
        </p>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <Field label="Move to" htmlFor="booking-override-target">
          <Select
            id="booking-override-target"
            value={to}
            onChange={(event) => setTo(event.target.value as JobStatus)}
            data-testid="booking-override-target"
          >
            {targets.length === 0 ? <option value="">No legal override from this status</option> : null}
            {targets.length > 1 ? <option value="">Choose a target…</option> : null}
            {targets.map((target) => (
              <option key={target} value={target}>
                {target.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>

        {to === 'completed' ? (
          <p className="text-xs text-text-secondary">
            Completing bills §7.4's waiting charge from the booking's snapshot and settles through
            the normal completion path.
          </p>
        ) : null}

        <Field label="Reason (required)" htmlFor="booking-override-reason">
          <Textarea
            id="booking-override-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What went wrong that the normal flow could not do — this lands in the audit trail."
            data-testid="booking-override-reason"
          />
        </Field>

        {errorMessage ? (
          <p className="text-sm text-error" role="alert" data-testid="booking-override-error">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button
          variant="destructive"
          onClick={() => void submit()}
          disabled={!ready || busy}
          data-testid="booking-override-submit"
        >
          {busy ? 'Applying…' : 'Apply override'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
