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
import {
  DISPUTE_REASON_CODES,
  type AdminDisputeOpenBody,
  type DisputeReasonCode,
  type JobStatus,
} from '@towing/api-contracts';
import { DISPUTE_REASON_LABELS } from './bookingStatus';

/**
 * `POST /admin/bookings/:id/dispute` — the only door into `disputed`, and the
 * only place a money-bearing booking can still be ended without settlement.
 *
 * The origin is DISPLAYED, not chosen: the API pins `opened_from_status` to
 * the booking's status at open time, and the five-exit table is defined per
 * origin — showing it here is how the operator knows which exits will exist
 * after filing.
 */
export function OpenDisputeDialog({
  open,
  onClose,
  bookingCode,
  openedFromStatus,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  bookingCode: string;
  openedFromStatus: JobStatus;
  isPending: boolean;
  onConfirm: (body: AdminDisputeOpenBody) => Promise<unknown>;
}) {
  const [reasonCode, setReasonCode] = useState<DisputeReasonCode>('service_not_completed');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReasonCode('service_not_completed');
      setDescription('');
      setPending(false);
      setErrorMessage(null);
    }
  }, [open]);

  const ready = description.trim().length >= 4;
  const busy = pending || isPending;

  const submit = async () => {
    if (!ready || busy) return;
    setPending(true);
    setErrorMessage(null);
    try {
      await onConfirm({ reasonCode, description: description.trim() });
      onClose();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="open-dispute-title">
      <DialogHeader>
        <DialogTitle id="open-dispute-title">Open a dispute on {bookingCode}</DialogTitle>
        <p className="text-sm text-text-secondary">
          The booking moves to <strong>disputed</strong> from <strong>{openedFromStatus}</strong>.
          The exits available afterwards follow the origin — the Disputes queue lists them when you
          resolve.
        </p>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <Field label="Reason" htmlFor="open-dispute-reason">
          <Select
            id="open-dispute-reason"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value as DisputeReasonCode)}
            data-testid="open-dispute-reason"
          >
            {DISPUTE_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {DISPUTE_REASON_LABELS[code] ?? code}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Description (required)" htmlFor="open-dispute-description">
          <Textarea
            id="open-dispute-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What the customer or driver claims, in enough detail that the queue's first reader needs no second source."
            data-testid="open-dispute-description"
          />
        </Field>

        {errorMessage ? (
          <p className="text-sm text-error" role="alert" data-testid="open-dispute-error">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={!ready || busy}
          data-testid="open-dispute-submit"
        >
          {busy ? 'Opening…' : 'Open dispute'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
