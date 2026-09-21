'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input, Skeleton } from '@towing/web-ui';
import type { AdminFinanceConfigDto } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useAdminFinanceConfig } from '../api/adminFinance.queries';
import { useUpdateFinanceConfig } from '../api/adminFinance.mutations';

/**
 * §9.4.10's money policy — the knobs that used to be TypeScript constants.
 *
 * THE PATCH IS A DIFF. Only fields the operator actually changed are sent, so
 * a save two minutes after somebody else moved the tax rate leaves that change
 * alone — which is what "a partial PUT changes only the field sent" means for
 * two people editing one singleton row.
 *
 * The window rule (partial fee window must not start before the free window
 * ends) is enforced HERE as well as in the schema and the DB: the console
 * disables Save and says why, rather than round-tripping a 422.
 */
export function FinanceConfigTab() {
  const toast = useToast();
  const { data, isLoading, isError } = useAdminFinanceConfig();
  const update = useUpdateFinanceConfig();

  const [form, setForm] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Seed once per loaded config — editing must not fight the refetch.
  useEffect(() => {
    if (data) {
      setForm({
        payoutMax: (data.payoutAutoApproveMaxPaise / 100).toString(),
        taxPct: String(data.taxPct),
        taxLabel: data.taxLabel,
        cancelFree: String(data.cancelFreeMinutes),
        cancelPartial: String(data.cancelPartialMinutes),
        cancelFee: (data.cancelPartialFeePaise / 100).toString(),
        compPct: String(data.cancelDriverCompPct),
      });
    }
  }, [data]);

  const number = (key: string): number => {
    const parsed = Number(form[key]);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const windowValid =
    Number.isNaN(number('cancelFree')) ||
    Number.isNaN(number('cancelPartial')) ||
    number('cancelPartial') >= number('cancelFree');
  const numbersValid = [
    'payoutMax',
    'taxPct',
    'cancelFree',
    'cancelPartial',
    'cancelFee',
    'compPct',
  ].every((key) => !Number.isNaN(number(key)) && number(key) >= 0);
  const canSave = Boolean(data) && windowValid && numbersValid && !update.isPending;

  const save = async () => {
    if (!data || !canSave) return;
    setErrorMessage(null);

    // The DIFF, field by field. `undefined` means untouched, and untouched
    // fields never appear in the PUT body.
    const patch: Partial<AdminFinanceConfigDto> = {};
    if (number('payoutMax') * 100 !== data.payoutAutoApproveMaxPaise) {
      patch.payoutAutoApproveMaxPaise = Math.round(number('payoutMax') * 100);
    }
    if (number('taxPct') !== data.taxPct) patch.taxPct = number('taxPct');
    if ((form.taxLabel ?? '') !== data.taxLabel) patch.taxLabel = (form.taxLabel ?? '').trim();
    if (number('cancelFree') !== data.cancelFreeMinutes) {
      patch.cancelFreeMinutes = Math.round(number('cancelFree'));
    }
    if (number('cancelPartial') !== data.cancelPartialMinutes) {
      patch.cancelPartialMinutes = Math.round(number('cancelPartial'));
    }
    if (number('cancelFee') * 100 !== data.cancelPartialFeePaise) {
      patch.cancelPartialFeePaise = Math.round(number('cancelFee') * 100);
    }
    if (number('compPct') !== data.cancelDriverCompPct) {
      patch.cancelDriverCompPct = number('compPct');
    }

    if (Object.keys(patch).length === 0) {
      toast('Nothing changed', 'info');
      return;
    }

    try {
      await update.mutateAsync(patch);
      toast('Finance policy updated', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  if (isError) {
    return <p className="text-sm text-error">Could not load the finance policy.</p>;
  }
  if (isLoading || !data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const money = (key: string, label: string, hint: string, testId: string) => (
    <Field label={label} htmlFor={testId}>
      <Input
        id={testId}
        inputMode="decimal"
        value={form[key] ?? ''}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        data-testid={testId}
      />
      <span className="mt-1 block text-xs text-text-tertiary">{hint}</span>
    </Field>
  );

  const count = (key: string, label: string, hint: string, testId: string) => (
    <Field label={label} htmlFor={testId}>
      <Input
        id={testId}
        inputMode="numeric"
        value={form[key] ?? ''}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        data-testid={testId}
      />
      <span className="mt-1 block text-xs text-text-tertiary">{hint}</span>
    </Field>
  );

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 font-display text-xl font-bold">Finance policy</h2>
      <p className="mb-4 text-sm text-text-secondary">
        One singleton row, audited like every other change. Payouts at or below the threshold skip
        the queue entirely.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {money(
          'payoutMax',
          'Payout auto-approve up to (₹)',
          'Above this, payouts wait for a human. Below it, they go straight to the bank.',
          'config-payout-max',
        )}
        {money(
          'taxPct',
          'Tax percent',
          'GST on the fare. Zero until an accountant says otherwise.',
          'config-tax-pct',
        )}
        <Field label="Tax label" htmlFor="config-tax-label">
          <Input
            id="config-tax-label"
            value={form.taxLabel ?? ''}
            onChange={(event) =>
              setForm((current) => ({ ...current, taxLabel: event.target.value }))
            }
            data-testid="config-tax-label"
          />
        </Field>
        {count(
          'cancelFree',
          'Free-cancel window (minutes)',
          'Cancelling inside this window costs the customer nothing.',
          'config-cancel-free',
        )}
        {count(
          'cancelPartial',
          'Partial-fee window (minutes)',
          'Past the free window and inside this one, the partial fee applies.',
          'config-cancel-partial',
        )}
        {money(
          'cancelFee',
          'Partial cancellation fee (₹)',
          'Charged when the free window has passed.',
          'config-cancel-fee',
        )}
        {money(
          'compPct',
          'Driver compensation (percent)',
          'The share of the fee the driver receives when the policy compensates them.',
          'config-comp-pct',
        )}
      </div>

      {!windowValid ? (
        <p className="mt-3 text-sm text-error" data-testid="config-window-error">
          The partial-fee window must not start before the free window ends.
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-3 text-sm text-error" role="alert" data-testid="config-error">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-5">
        <Button onClick={() => void save()} disabled={!canSave} data-testid="config-save">
          {update.isPending ? 'Saving…' : 'Save policy'}
        </Button>
      </div>
    </div>
  );
}
