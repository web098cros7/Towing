'use client';

import { useEffect, useState } from 'react';
import type { AdminUserCorrection } from '@towing/api-contracts';
import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@towing/web-ui';
import { ApiError } from '@/lib/apiClient';

/**
 * W19's correction dialog (§20.4 DPDP's correction right, served by an
 * operator on a request).
 *
 * A REASON IS REQUIRED, and the form deletes rather than hides: only fields the
 * operator actually edits are sent, so the audit row's before/after is "what
 * changed", not "the whole record, re-stated". The mobile field keeps the
 * backend's 10-digit rule on the client too — a server 422 for a typo the
 * input could have caught is a worse experience than a disabled button.
 */
export interface CorrectUserDialogProps {
  open: boolean;
  onClose: () => void;
  initial: { name: string | null; email: string | null; mobile: string | null };
  onSubmit: (body: AdminUserCorrection) => Promise<unknown>;
}

export function CorrectUserDialog({ open, onClose, initial, onSubmit }: CorrectUserDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setMobile('');
    setReason('');
    setError(null);
  }, [open]);

  const mobileValid = mobile === '' || /^\d{10}$/.test(mobile);
  const anyChange = name.trim() !== '' || email.trim() !== '' || mobile.trim() !== '';
  const canSubmit = anyChange && reason.trim().length >= 3 && mobileValid && !pending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="correct-user-title"
      className="w-[min(26rem,calc(100vw-2rem))]"
    >
      <DialogHeader>
        <DialogTitle id="correct-user-title">Correct customer details</DialogTitle>
        <p className="mt-1 text-sm text-text-secondary">
          Only the fields you fill in change. The before/after and your reason are written to the
          audit trail.
        </p>
      </DialogHeader>

      <div className="space-y-3">
        <Field label="Name" htmlFor="correct-name">
          <Input
            id="correct-name"
            data-testid="correct-name"
            value={name}
            placeholder={initial.name ?? 'unchanged'}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="correct-email">
          <Input
            id="correct-email"
            data-testid="correct-email"
            value={email}
            placeholder={initial.email ?? 'unchanged'}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Mobile (10 digits)" htmlFor="correct-mobile">
          <Input
            id="correct-mobile"
            data-testid="correct-mobile"
            value={mobile}
            placeholder={initial.mobile ?? 'unchanged'}
            onChange={(event) => setMobile(event.target.value)}
          />
        </Field>
        {mobileValid ? null : (
          <p className="text-xs text-error" data-testid="correct-mobile-error">
            A mobile number is 10 digits.
          </p>
        )}
        <Field label="Reason (audited)" htmlFor="correct-reason">
          <Input
            id="correct-reason"
            data-testid="correct-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {error ? (
          <p className="text-sm text-error" data-testid="correct-error">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          data-testid="correct-submit"
          disabled={!canSubmit}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await onSubmit({
                ...(name.trim() ? { name: name.trim() } : {}),
                ...(email.trim() ? { email: email.trim() } : {}),
                ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
                reason: reason.trim(),
              });
            } catch (submitError) {
              setError(
                submitError instanceof ApiError ? submitError.message : 'The correction failed.',
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? 'Saving…' : 'Save correction'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
