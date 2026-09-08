'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@towing/web-ui';
import { ApiError } from '@/lib/apiClient';
import { formatPaise } from '@/lib/money';
import { useRequestPayout } from '../api/earnings.queries';
import type { EarningsSummary } from '../types';

/**
 * §9.3.7's "payout requests (Route)".
 *
 * ⚠ **The `Idempotency-Key` is minted ONCE per user intent** — when the dialog
 * opens — and reused for every submit inside that session of the dialog. If it
 * were generated inside the fetch, a retry (React Query's, the browser's, or a
 * user double-tap) would look like a brand new payout to the server and could
 * genuinely send the money twice. This is the single most dangerous line in the
 * Phase 7 web work; a new key requires a new intent, i.e. reopening the dialog.
 */
export function RequestPayoutDialog({
  open,
  onClose,
  wallet,
}: {
  open: boolean;
  onClose: () => void;
  wallet: EarningsSummary['wallet'];
}) {
  const [amount, setAmount] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const requestPayout = useRequestPayout();

  // One key per opening of the dialog.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setIdempotencyKey(crypto.randomUUID());
    setAmount(String(Math.floor(wallet.availablePaise / 100)));
    setClientError(null);
    requestPayout.reset();
    // `wallet.availablePaise` intentionally excluded: re-prefilling the field
    // while the dialog is open would overwrite what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const amountPaise = useMemo(() => Math.round(Number(amount) * 100), [amount]);

  const submit = (): void => {
    // The same rules the server enforces, checked here only to save a round
    // trip. The server's answer is always the authority — see the 422 handling.
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      setClientError('Enter an amount to withdraw');
      return;
    }
    if (amountPaise < wallet.minPayoutPaise) {
      setClientError(`The minimum payout is ${formatPaise(wallet.minPayoutPaise)}`);
      return;
    }
    if (amountPaise > wallet.availablePaise) {
      setClientError(`You have ${formatPaise(wallet.availablePaise)} available`);
      return;
    }

    setClientError(null);
    requestPayout.mutate(
      { amountPaise, idempotencyKey },
      { onSuccess: () => onClose() },
    );
  };

  const serverError =
    requestPayout.error instanceof ApiError
      ? requestPayout.error.message
      : requestPayout.error
        ? 'Could not request the payout. Please try again.'
        : null;

  return (
    <Dialog open={open} onClose={onClose} labelledBy="request-payout-title">
      <DialogHeader>
        <DialogTitle id="request-payout-title">Request payout</DialogTitle>
        <DialogDescription>
          Paid into your linked bank account via Razorpay Route. Settlement usually completes
          within one working day.
        </DialogDescription>
      </DialogHeader>

      <DialogBody>
        <Field label="Amount (₹)" htmlFor="payout-amount" error={clientError ?? serverError ?? undefined}>
          <Input
            id="payout-amount"
            type="number"
            inputMode="decimal"
            min={wallet.minPayoutPaise / 100}
            max={wallet.availablePaise / 100}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={requestPayout.isPending}
          />
        </Field>

        <dl className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <dt>Available</dt>
          <dd className="text-right tabular-nums text-text-primary">
            {formatPaise(wallet.availablePaise)}
          </dd>
          <dt>Minimum</dt>
          <dd className="text-right tabular-nums">{formatPaise(wallet.minPayoutPaise)}</dd>
        </dl>
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={requestPayout.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={requestPayout.isPending}>
          {requestPayout.isPending ? 'Requesting…' : 'Request payout'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
