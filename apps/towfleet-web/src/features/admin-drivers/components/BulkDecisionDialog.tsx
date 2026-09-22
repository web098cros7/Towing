'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
} from '@towing/web-ui';
import { useBulkDecideKyc } from '../api/adminDrivers.mutations';
import type { AdminPendingDriver, KycBulkDecision } from '../types';

/**
 * W7's bulk confirmation.
 *
 * Typed confirmation for BOTH decisions, not just the dangerous one: §9.4.3
 * wants a human on a bulk approval ("bulk approval is exactly the action the
 * spec wants a human on"), and a reject silently applying one shared reason to
 * forty drivers is the other way this could go wrong.
 *
 * The results panel is the point of the whole flow: the API never answers
 * all-or-nothing, so the dialog STAYS OPEN after submitting and lists every
 * driver's outcome — a partial failure is the case an operator must not miss.
 */
export interface BulkDecisionDialogProps {
  open: boolean;
  decision: KycBulkDecision;
  /** The selected rows — names, so results are readable without a second lookup. */
  drivers: AdminPendingDriver[];
  onClose: () => void;
  /** Fired once a run has happened, so the page can drop its selection. */
  onCompleted: () => void;
}

export function BulkDecisionDialog({
  open,
  decision,
  drivers,
  onClose,
  onCompleted,
}: BulkDecisionDialogProps) {
  const bulk = useBulkDecideKyc();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [completed, setCompleted] = useState(false);

  const requiredWord = decision === 'approve' ? 'APPROVE' : 'REJECT';

  useEffect(() => {
    if (open) {
      setReason('');
      setTyped('');
      setCompleted(false);
      bulk.reset();
    }
    // `bulk.reset` is stable; re-running on `bulk` identity would clear the
    // results the moment the mutation settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, decision]);

  const result = bulk.data ?? null;
  const reasonReady = decision === 'approve' || reason.trim().length >= 3;
  const canSubmit =
    typed.trim().toUpperCase() === requiredWord && reasonReady && !bulk.isPending && !completed;

  const submit = () => {
    if (!canSubmit) return;
    bulk.mutate(
      {
        decision,
        driverIds: drivers.map((driver) => driver.id),
        ...(decision === 'reject' ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          setCompleted(true);
          onCompleted();
        },
      },
    );
  };

  const nameFor = (driverId: string) =>
    drivers.find((driver) => driver.id === driverId)?.name ?? driverId.slice(0, 8);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="bulk-decision-title"
      className="w-[min(44rem,calc(100vw-2rem))]"
    >
      <DialogHeader>
        <DialogTitle id="bulk-decision-title">
          {decision === 'approve' ? 'Approve' : 'Reject'} {drivers.length}{' '}
          {drivers.length === 1 ? 'driver' : 'drivers'}
        </DialogTitle>
        <DialogDescription>
          {decision === 'approve'
            ? 'Each driver is decided on their own — one refusal never rolls back the rest.'
            : 'One reason is recorded against every driver below, and each decision is audited separately.'}
        </DialogDescription>
      </DialogHeader>

      <DialogBody>
        {result ? (
          <div className="flex flex-col gap-3" data-testid="bulk-results">
            <p className="text-sm" data-testid="bulk-summary">
              {result.succeeded} of {result.results.length} decided
              {result.failed > 0 ? ` — ${result.failed} failed` : ''}.
            </p>
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {result.results.map((item) => (
                <li
                  key={item.driverId}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  data-testid={`bulk-result-${item.driverId}`}
                >
                  <span>{nameFor(item.driverId)}</span>
                  {item.ok ? (
                    <Badge variant="success">{item.kycStatus ?? 'done'}</Badge>
                  ) : (
                    <span className="text-xs text-error">
                      {item.error?.code ?? 'error'} — {item.error?.message ?? 'Decision failed'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="max-h-40 overflow-y-auto text-sm text-text-secondary">
              {drivers.map((driver) => (
                <li key={driver.id}>{driver.name ?? driver.id.slice(0, 8)}</li>
              ))}
            </ul>

            {decision === 'reject' ? (
              <Field label="Reason (required)" htmlFor="bulk-reason">
                <Textarea
                  id="bulk-reason"
                  rows={3}
                  data-testid="bulk-reason"
                  placeholder="Recorded against every driver and in each audit row."
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            ) : null}

            <Field label={`Type “${requiredWord}” to confirm`} htmlFor="bulk-confirm-word">
              <Input
                id="bulk-confirm-word"
                data-testid="bulk-confirm-word"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
              />
            </Field>

            {bulk.error ? (
              <p className="text-sm text-error" role="alert" data-testid="bulk-error">
                {(bulk.error as Error).message}
              </p>
            ) : null}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        {result ? (
          <Button onClick={onClose} data-testid="bulk-close">
            Close
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={bulk.isPending}>
              Cancel
            </Button>
            <Button
              variant={decision === 'approve' ? 'primary' : 'destructive'}
              disabled={!canSubmit}
              onClick={submit}
              data-testid="bulk-submit"
            >
              {bulk.isPending
                ? 'Working…'
                : decision === 'approve'
                  ? `Approve ${drivers.length}`
                  : `Reject ${drivers.length}`}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
