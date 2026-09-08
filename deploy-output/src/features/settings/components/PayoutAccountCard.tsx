'use client';

import { useState } from 'react';
import { payoutAccountLinkSchema } from '@towing/api-contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@towing/web-ui';
import { ApiError } from '@/lib/apiClient';
import { useLinkPayoutAccount, useUnlinkPayoutAccount } from '../api/settings.queries';
import type { FleetSettings, PayoutAccount } from '../types';

const statusVariant: Record<PayoutAccount['status'], 'neutral' | 'warning' | 'success' | 'error'> = {
  unlinked: 'neutral',
  pending: 'warning',
  active: 'success',
  rejected: 'error',
  suspended: 'error',
};

/**
 * §9.3.1's "bank details for payouts (Route)" — the destination
 * `POST /fleet/payouts` pays into.
 *
 * The full account number is entered here, sent to the provider, and never
 * stored: only the last four digits ever come back, which is why re-linking
 * requires re-entering the whole number rather than editing a masked field.
 */
export function PayoutAccountCard({
  settings,
  onLinked,
}: {
  settings: FleetSettings;
  onLinked?: () => void;
}) {
  const account = settings.payoutAccount;
  const [editing, setEditing] = useState(account.status === 'unlinked');
  const [beneficiaryName, setBeneficiaryName] = useState(settings.businessName);
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const link = useLinkPayoutAccount();
  const unlink = useUnlinkPayoutAccount();

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();

    const parsed = payoutAccountLinkSchema.safeParse({
      beneficiaryName,
      accountNumber,
      ifsc: ifsc.toUpperCase(),
    });

    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === undefined ? '_' : String(issue.path[0]);
        out[key] ??= issue.message;
      }
      setErrors(out);
      return;
    }

    setErrors({});
    link.mutate(
      // One key per submit attempt — this creates a vendor-side account, so a
      // network retry must not create a second one.
      { input: parsed.data, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: () => {
          setAccountNumber('');
          setEditing(false);
          onLinked?.();
        },
        onError: (error) => {
          setErrors({ _: error instanceof ApiError ? error.message : 'Could not link the account' });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Payout bank account</span>
          <Badge variant={statusVariant[account.status]}>{account.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {account.status !== 'unlinked' && !editing ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-text-secondary">Beneficiary</dt>
              <dd>{account.beneficiaryName ?? '—'}</dd>
              <dt className="text-text-secondary">Account</dt>
              <dd className="tabular-nums">•••• {account.accountNumberLast4 ?? '••••'}</dd>
              <dt className="text-text-secondary">IFSC</dt>
              <dd className="tabular-nums">{account.ifsc ?? '—'}</dd>
              {account.bankName ? (
                <>
                  <dt className="text-text-secondary">Bank</dt>
                  <dd>{account.bankName}</dd>
                </>
              ) : null}
            </dl>

            {account.failureReason ? (
              <p className="text-xs text-error">{account.failureReason}</p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                Change account
              </Button>
              <Button
                variant="ghost"
                onClick={() => unlink.mutate(undefined)}
                disabled={unlink.isPending}
              >
                {unlink.isPending ? 'Removing…' : 'Remove'}
              </Button>
            </div>
            {unlink.error ? (
              <p className="text-xs text-error">
                {unlink.error instanceof ApiError ? unlink.error.message : 'Could not remove the account'}
              </p>
            ) : null}
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Beneficiary name" htmlFor="beneficiary" error={errors.beneficiaryName}>
              <Input
                id="beneficiary"
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
                disabled={link.isPending}
              />
            </Field>
            <Field label="Account number" htmlFor="accountNumber" error={errors.accountNumber}>
              <Input
                id="accountNumber"
                inputMode="numeric"
                autoComplete="off"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                disabled={link.isPending}
              />
            </Field>
            <Field label="IFSC" htmlFor="ifsc" error={errors.ifsc}>
              <Input
                id="ifsc"
                placeholder="HDFC0000123"
                value={ifsc}
                onChange={(e) => setIfsc(e.target.value)}
                disabled={link.isPending}
              />
            </Field>

            <p className="text-xs text-text-tertiary">
              We never store your full account number — it goes to Razorpay Route and we keep only
              the last four digits.
            </p>

            {errors._ ? <p className="text-xs text-error">{errors._}</p> : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={link.isPending}>
                {link.isPending ? 'Linking…' : 'Link account'}
              </Button>
              {account.status !== 'unlinked' ? (
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={link.isPending}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
