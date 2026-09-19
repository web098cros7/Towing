'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle, Field, Input, Textarea } from '@towing/web-ui';

/**
 * W6's shared suspend confirmation: a required reason, and — for fleets — a
 * typed-name gate, because that one action can take a whole fleet offline
 * (the guide asks for both).
 *
 * Owns its error line rather than using `ConfirmDialog`: a refusal here is
 * usually MEANINGFUL (support gets 403 + "a request was filed"), and the
 * message must be readable next to the reason the operator just typed.
 */
export interface SuspendSubjectDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** What the operator must type verbatim when `requireTypedName` is set. */
  typedName?: string;
  minReasonLength?: number;
  confirmLabel?: string;
  /** Red is right for suspensions; the impersonation session uses primary. */
  submitVariant?: 'destructive' | 'primary';
  isPending?: boolean;
  errorMessage?: string | null;
  onConfirm: (reason: string) => Promise<unknown> | void;
  testId?: string;
}

export function SuspendSubjectDialog({
  open,
  onClose,
  title,
  description,
  typedName,
  minReasonLength = 4,
  confirmLabel = 'Suspend',
  submitVariant = 'destructive',
  isPending = false,
  errorMessage,
  onConfirm,
  testId = 'suspend-dialog',
}: SuspendSubjectDialogProps) {
  const [reason, setReason] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setNameInput('');
      setPending(false);
    }
  }, [open]);

  const reasonReady = reason.trim().length >= minReasonLength;
  const nameReady = typedName === undefined || nameInput.trim() === typedName;
  const canSubmit = reasonReady && nameReady && !pending && !isPending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy={`${testId}-title`}>
      <DialogHeader>
        <DialogTitle id={`${testId}-title`}>{title}</DialogTitle>
        {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
      </DialogHeader>

      <div className="space-y-4 py-2">
        <Field label="Reason (required)" htmlFor={`${testId}-reason`}>
          <Textarea
            id={`${testId}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Shown in the audit trail and, for requests, to the approver."
            data-testid={`${testId}-reason`}
          />
        </Field>

        {typedName ? (
          <Field label={`Type “${typedName}” to confirm`} htmlFor={`${testId}-name`}>
            <Input
              id={`${testId}-name`}
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              data-testid={`${testId}-typed-name`}
            />
          </Field>
        ) : null}
        {typedName ? (
          <p className="text-xs text-text-secondary">
            This action takes every driver of the fleet offline.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="text-sm text-error" role="alert" data-testid={`${testId}-error`}>
            {errorMessage}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={pending || isPending}>
          Cancel
        </Button>
        <Button
          variant={submitVariant}
          onClick={() => void submit()}
          disabled={!canSubmit}
          data-testid={`${testId}-submit`}
        >
          {pending || isPending ? 'Working…' : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
