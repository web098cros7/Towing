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
import type { AdminBookingCancelBody, BookingCancelFeeMode } from '@towing/api-contracts';

/**
 * W8's cancel, with the fee decision ON its face.
 *
 * The two modes are the whole policy: `waive` is G4's default, and
 * `apply_policy` mirrors the customer-cancel tiers from the booking's current
 * status — the API computes the fee from the snapshot, this dialog only says
 * which rule applies. `compensateDriver` FORCES the driver's compensation on
 * even under `waive`; without the checkbox an operator waiving the customer
 * fee would silently also zero the driver's pay for a trip they had started.
 */
export function BookingCancelDialog({
  open,
  onClose,
  bookingCode,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  bookingCode: string;
  isPending: boolean;
  onConfirm: (body: AdminBookingCancelBody) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [feeMode, setFeeMode] = useState<BookingCancelFeeMode>('waive');
  const [compensateDriver, setCompensateDriver] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setFeeMode('waive');
      setCompensateDriver(false);
      setPending(false);
      setErrorMessage(null);
    }
  }, [open]);

  const ready = reason.trim().length >= 4;
  const busy = pending || isPending;

  const submit = async () => {
    if (!ready || busy) return;
    setPending(true);
    setErrorMessage(null);
    try {
      await onConfirm({ reason: reason.trim(), feeMode, compensateDriver });
      onClose();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="booking-cancel-title">
      <DialogHeader>
        <DialogTitle id="booking-cancel-title">Cancel {bookingCode}</DialogTitle>
        <p className="text-sm text-text-secondary">
          The customer is told, the driver's live offer is revoked, and any searching coupon is
          released. The fee is recorded; collection is a separate money path.
        </p>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <Field label="Reason (required)" htmlFor="booking-cancel-reason">
          <Textarea
            id="booking-cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Shown in the audit trail and to the customer's support thread."
            data-testid="booking-cancel-reason"
          />
        </Field>

        <Field label="Cancellation fee" htmlFor="booking-cancel-fee-mode">
          <Select
            id="booking-cancel-fee-mode"
            value={feeMode}
            onChange={(event) => setFeeMode(event.target.value as BookingCancelFeeMode)}
            data-testid="booking-cancel-fee-mode"
          >
            <option value="waive">Waive the fee</option>
            <option value="apply_policy">Apply the customer-cancel policy</option>
          </Select>
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-brand"
            checked={compensateDriver}
            onChange={(event) => setCompensateDriver(event.target.checked)}
            data-testid="booking-cancel-compensate"
          />
          <span>
            Compensate the driver
            <span className="block text-xs text-text-secondary">
              Posts the driver's compensation even under a waiver — they may already be en route.
            </span>
          </span>
        </label>

        {errorMessage ? (
          <p className="text-sm text-error" role="alert" data-testid="booking-cancel-error">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep booking
        </Button>
        <Button
          variant="destructive"
          onClick={() => void submit()}
          disabled={!ready || busy}
          data-testid="booking-cancel-submit"
        >
          {busy ? 'Cancelling…' : 'Cancel booking'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
