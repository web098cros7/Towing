'use client';

import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from './Dialog';
import { Field } from './Input';
import { Textarea } from './Textarea';
import { cn } from '../lib/cn';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the danger tone (suspend, delete, reject). */
  destructive?: boolean;
  /**
   * The reason-required variant (§3.3): the confirm button stays DISABLED
   * until the operator types at least `minLength` characters. Callers that
   * audit `reason` (every admin write does — rule 5) get a guaranteed
   * non-empty value instead of a form that silently sends null.
   */
  reasonRequired?: { label: string; minLength?: number; placeholder?: string };
  /** Return a promise to keep the dialog open, disabled, until it settles. */
  onConfirm: (reason: string | null) => void | Promise<void>;
  confirmTestId?: string;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  reasonRequired,
  onConfirm,
  confirmTestId = 'confirm-dialog-submit',
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  // A reopened dialog must never carry the previous decision's reason.
  useEffect(() => {
    if (open) {
      setReason('');
      setPending(false);
    }
  }, [open]);

  const minLength = reasonRequired?.minLength ?? 3;
  const reasonTooShort = reasonRequired ? reason.trim().length < minLength : false;

  const submit = async () => {
    if (reasonTooShort) return;
    setPending(true);
    try {
      await onConfirm(reasonRequired ? reason.trim() : null);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} labelledBy="confirm-dialog-title">
      <DialogHeader>
        <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>

      {reasonRequired ? (
        <Field label={reasonRequired.label} htmlFor="confirm-dialog-reason">
          <Textarea
            id="confirm-dialog-reason"
            data-testid="confirm-dialog-reason"
            placeholder={reasonRequired.placeholder}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={reasonTooShort && reason.length > 0 ? true : undefined}
            rows={3}
          />
        </Field>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'primary'}
          data-testid={confirmTestId}
          disabled={reasonTooShort || pending}
          onClick={() => void submit()}
          className={cn(pending && 'opacity-80')}
        >
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
