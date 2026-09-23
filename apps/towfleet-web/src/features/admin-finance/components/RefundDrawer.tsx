'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Field,
  Input,
  Textarea,
} from '@towing/web-ui';
import type { AdminRefundIssueResponse } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { env } from '@/lib/env';
import { formatPaise } from '@/lib/money';
import { useIssueRefund } from '../api/adminFinance.mutations';
import { RefundTermsFields, type RefundTermsState } from './RefundTermsFields';

/**
 * The refund form, full or partial by shape: leave the amount blank to refund
 * the remaining captured balance in full, or type one and say WHY — ADM-6's
 * cause decides who pays (`RefundTermsFields`).
 *
 * THE IDEMPOTENCY KEY IS MINTED ON OPEN, not per submit — a retry of the same
 * intent must reuse it (that is the whole mechanism), while closing and
 * reopening genuinely is a new request. `crypto.randomUUID()` in the browser,
 * hashed server-side with the admin id so two operators sending `1` never
 * collide.
 */
export function RefundDrawer({
  open,
  onClose,
  operatorName,
}: {
  open: boolean;
  onClose: () => void;
  operatorName: string | null;
}) {
  const toast = useToast();
  const issue = useIssueRefund();

  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [termsState, setTermsState] = useState<RefundTermsState>(INITIAL_TERMS);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<AdminRefundIssueResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIdempotencyKey(crypto.randomUUID());
      setBookingId('');
      setAmountRupees('');
      setTermsState(INITIAL_TERMS);
      setReason('');
      setResult(null);
      setErrorMessage(null);
    }
  }, [open]);

  const isPartial = amountRupees.trim() !== '';
  const amountPaise = isPartial ? Math.round(Number(amountRupees) * 100) : null;
  const amountValid =
    !isPartial || (amountPaise !== null && Number.isFinite(amountPaise) && amountPaise > 0);
  // A uuid is what the API takes; the console asks for the whole id rather
  // than half-helping with a lookup that could match the wrong booking.
  const bookingValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    bookingId.trim(),
  );
  const reasonValid = reason.trim().length >= 4;
  const canSubmit =
    bookingValid &&
    amountValid &&
    reasonValid &&
    (!isPartial || termsState.valid) &&
    !issue.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    setErrorMessage(null);
    try {
      const response = await issue.mutateAsync({
        body: {
          bookingId: bookingId.trim(),
          reason: reason.trim(),
          ...(isPartial ? { amountPaise: amountPaise as number, terms: termsState.terms } : {}),
        },
        idempotencyKey,
      });
      setResult(response);
      toast(
        response.replayed
          ? 'This refund had already been issued — nothing moved twice.'
          : `Refund issued — ${formatPaise(response.amountPaise)}.`,
        'success',
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} labelledBy="refund-drawer-title">
      <DrawerHeader>
        <DrawerTitle id="refund-drawer-title">Issue a refund</DrawerTitle>
        <p className="text-sm text-text-secondary">
          A full refund moves the booking out of <strong>paid</strong>. A partial keeps it paid, and
          the reason you give decides who pays for it.
        </p>
      </DrawerHeader>

      <DrawerBody>
        {result ? (
          <div
            className="rounded-card border border-border p-4 text-sm"
            data-testid="refund-result"
          >
            <p className="font-semibold text-success-soft-fg">
              {result.kind === 'full' ? 'Full refund' : 'Partial refund'} of{' '}
              {formatPaise(result.amountPaise)} — {result.status}
            </p>
            <p className="mt-1 font-mono text-xs text-text-secondary">{result.refundId}</p>
            {result.replayed ? (
              <p className="mt-1 text-xs text-text-secondary">
                Replayed: this idempotency key had already produced this refund.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <Field label="Booking id" htmlFor="refund-booking">
              <Input
                id="refund-booking"
                value={bookingId}
                onChange={(event) => setBookingId(event.target.value)}
                placeholder="Paste the booking UUID (the Disputes queue shows it)"
                data-testid="refund-booking"
              />
            </Field>

            <Field label="Amount (₹) — leave blank to refund everything" htmlFor="refund-amount">
              <Input
                id="refund-amount"
                inputMode="decimal"
                value={amountRupees}
                onChange={(event) => setAmountRupees(event.target.value)}
                placeholder="e.g. 500"
                data-testid="refund-amount"
              />
            </Field>

            {isPartial ? (
              <RefundTermsFields key={idempotencyKey} idPrefix="refund" onChange={setTermsState} />
            ) : null}

            <Field label="Reason (required)" htmlFor="refund-reason">
              <Textarea
                id="refund-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="What was checked and why the money goes back — this lands on the refund row and in the audit trail."
                data-testid="refund-reason"
              />
            </Field>

            <p className="text-xs text-text-tertiary">
              Issued as {operatorName ?? 'this admin'}. Under mocks this refuses — a mocked refund
              would only prove the mock resolves.
            </p>

            {errorMessage ? (
              <p className="text-sm text-error" role="alert" data-testid="refund-error">
                {errorMessage}
              </p>
            ) : null}
          </>
        )}
      </DrawerBody>

      <DrawerFooter>
        <Button variant="secondary" onClick={onClose}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {result ? null : (
          <Button
            onClick={() => void submit()}
            disabled={!canSubmit}
            title={env.useMocks ? 'Mocks are on — a refund needs the real backend' : undefined}
            data-testid="refund-submit"
          >
            {issue.isPending ? 'Issuing…' : 'Issue refund'}
          </Button>
        )}
      </DrawerFooter>
    </Drawer>
  );
}

/** Matches `RefundTermsFields`' own starting state, so the first render submits what it shows. */
const INITIAL_TERMS: RefundTermsState = {
  terms: { cause: 'fare_error', delivery: 'original' },
  valid: true,
};
