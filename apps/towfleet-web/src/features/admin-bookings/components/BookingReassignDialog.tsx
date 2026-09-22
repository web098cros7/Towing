'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Textarea,
} from '@towing/web-ui';
import type { AdminBookingReassignBody } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { adminBookingDriverChoicesMock } from '../mocks/adminBookings.mock';

/**
 * §6.5's reassign, two modes:
 *
 *  - `redispatch` widens the search again and EXCLUDES the driver it moved
 *    away from (the API's shortlist never re-offers the same job to the same
 *    person in the same wave).
 *  - `offer_to_driver` puts one EXCLUSIVE offer on one chosen driver's phone.
 *
 * `driverFault` is the honest flag, not a punishment: at fault, the previous
 * driver's attempt records as `unable` (hurting their completion rate);
 * otherwise it records as `reassigned`, which is not their fault and says so
 * in the data.
 *
 * In mocks the driver picker is a fixture select; live it is a UUID input with
 * a pointer at the Drivers directory, because this dialog has no fleet-scoped
 * shortlist endpoint to populate a select from — and inventing one here would
 * be a second candidate-selection surface to keep honest.
 */
export function BookingReassignDialog({
  open,
  onClose,
  bookingCode,
  currentDriverName,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  bookingCode: string;
  currentDriverName: string | null;
  isPending: boolean;
  onConfirm: (body: AdminBookingReassignBody) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<AdminBookingReassignBody['mode']>('redispatch');
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState('');
  const [driverFault, setDriverFault] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode('redispatch');
      setDriverId('');
      setReason('');
      setDriverFault(false);
      setPending(false);
      setErrorMessage(null);
    }
  }, [open]);

  const reasonReady = reason.trim().length >= 4;
  const driverReady = mode === 'redispatch' || driverId.trim().length > 0;
  const busy = pending || isPending;

  const submit = async () => {
    if (!reasonReady || !driverReady || busy) return;
    setPending(true);
    setErrorMessage(null);
    try {
      await onConfirm({
        mode,
        driverId: mode === 'offer_to_driver' ? driverId.trim() : undefined,
        reason: reason.trim(),
        driverFault,
      });
      onClose();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="booking-reassign-title">
      <DialogHeader>
        <DialogTitle id="booking-reassign-title">Reassign {bookingCode}</DialogTitle>
        <p className="text-sm text-text-secondary">
          {currentDriverName
            ? `Moves the job away from ${currentDriverName}.`
            : 'The booking currently has no driver.'}
        </p>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <Field label="Mode" htmlFor="booking-reassign-mode">
          <Select
            id="booking-reassign-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as AdminBookingReassignBody['mode'])}
            data-testid="booking-reassign-mode"
          >
            <option value="redispatch">Re-dispatch (widen the search)</option>
            <option value="offer_to_driver">Offer to one driver (exclusive)</option>
          </Select>
        </Field>

        {mode === 'offer_to_driver' ? (
          <Field label="Driver" htmlFor="booking-reassign-driver">
            {env.useMocks ? (
              <Select
                id="booking-reassign-driver"
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
                data-testid="booking-reassign-driver"
              >
                <option value="">Choose a driver…</option>
                {adminBookingDriverChoicesMock.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="booking-reassign-driver"
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
                placeholder="Driver id (UUID)"
                data-testid="booking-reassign-driver"
              />
            )}
          </Field>
        ) : null}

        <Field label="Reason (required)" htmlFor="booking-reassign-reason">
          <Textarea
            id="booking-reassign-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why the job is moving — recorded on the attempt and in the audit trail."
            data-testid="booking-reassign-reason"
          />
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-brand"
            checked={driverFault}
            onChange={(event) => setDriverFault(event.target.checked)}
            data-testid="booking-reassign-fault"
          />
          <span>
            The previous driver was at fault
            <span className="block text-xs text-text-secondary">
              Records the attempt as `unable` (affects their completion rate); leave unchecked to
              record it as `reassigned`.
            </span>
          </span>
        </label>

        {errorMessage ? (
          <p className="text-sm text-error" role="alert" data-testid="booking-reassign-error">
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
          disabled={!reasonReady || !driverReady || busy}
          data-testid="booking-reassign-submit"
        >
          {busy ? 'Reassigning…' : 'Reassign'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
