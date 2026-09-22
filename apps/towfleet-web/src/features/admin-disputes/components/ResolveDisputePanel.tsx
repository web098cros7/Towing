'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@towing/web-ui';
import type {
  AdminDisputeResolveBody,
  DisputeLiability,
  DisputeResolution,
} from '@towing/api-contracts';

/**
 * THE FIVE EXITS (§5.6), in the console.
 *
 * Each exit is a row of this table, and the panel shows only the fields its
 * exit defines — the contract's `superRefine` and the resolver both REFUSE
 * mismatched shapes, so rendering an amount input on `uphold_charge` would be
 * offering a request the API rejects.
 *
 * The consequence line under each option is the part operators actually need:
 * where the booking ends and what money moves. `partial_refund` converts the
 * typed rupees to paise HERE, exactly once, rounding to the nearest paisa.
 */
const EXITS: {
  value: DisputeResolution;
  label: string;
  consequence: string;
}[] = [
  {
    value: 'complete_and_charge',
    label: 'Complete and charge',
    consequence: 'Booking → completed, then settles normally. The customer pays in full.',
  },
  {
    value: 'cancel_no_charge',
    label: 'Cancel, no charge',
    consequence: 'Booking → cancelled. Nothing is captured; driver compensation is optional.',
  },
  {
    value: 'uphold_charge',
    label: 'Uphold the charge',
    consequence: 'Booking stays paid. Nothing moves — the dispute just closes.',
  },
  {
    value: 'full_refund',
    label: 'Full refund',
    consequence: 'Booking → cancelled and the captured payment is reversed in full.',
  },
  {
    value: 'partial_refund',
    label: 'Partial refund',
    consequence:
      'Booking stays paid. The typed amount is refunded; the chosen party is debited by it.',
  },
];

export function ResolveDisputePanel({
  openedFromStatus,
  isPending,
  onResolve,
}: {
  openedFromStatus: string;
  isPending: boolean;
  onResolve: (body: AdminDisputeResolveBody) => Promise<unknown>;
}) {
  const [resolution, setResolution] = useState<DisputeResolution>('complete_and_charge');
  const [note, setNote] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [liability, setLiability] = useState<DisputeLiability>('driver');
  const [compensateDriver, setCompensateDriver] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // `uphold_charge` only exists for disputes opened FROM `paid` — the A9
  // settlement guard is what makes it meaningful, and there is nothing to
  // uphold on a booking that never charged.
  const exits = EXITS.filter(
    (exit) => exit.value !== 'uphold_charge' || openedFromStatus === 'paid',
  );

  useEffect(() => {
    setErrorMessage(null);
  }, [resolution]);

  const amountPaise =
    resolution === 'partial_refund' && amountRupees.trim() !== ''
      ? Math.round(Number(amountRupees) * 100)
      : null;
  const amountReady =
    resolution !== 'partial_refund' ||
    (amountPaise !== null && Number.isFinite(amountPaise) && amountPaise > 0);
  const noteReady = note.trim().length >= 4;
  const busy = pending || isPending;

  const submit = async () => {
    if (!noteReady || !amountReady || busy) return;
    setPending(true);
    setErrorMessage(null);
    try {
      await onResolve({
        resolution,
        note: note.trim(),
        ...(resolution === 'partial_refund'
          ? { refundAmountPaise: amountPaise as number, liability }
          : {}),
        ...(resolution === 'cancel_no_charge' ? { compensateDriver } : {}),
      });
      setNote('');
      setAmountRupees('');
      setCompensateDriver(false);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label="Resolve dispute" data-testid="resolve-panel">
      <h3 className="mb-2 text-sm font-semibold">Resolve</h3>

      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Resolution">
        {exits.map((exit) => (
          <label
            key={exit.value}
            className={
              resolution === exit.value
                ? 'flex cursor-pointer items-start gap-2 rounded-card border border-brand bg-brand-tint/40 p-2.5 text-sm'
                : 'flex cursor-pointer items-start gap-2 rounded-card border border-border p-2.5 text-sm'
            }
          >
            <input
              type="radio"
              name="dispute-resolution"
              className="mt-0.5 size-4 accent-brand"
              checked={resolution === exit.value}
              onChange={() => setResolution(exit.value)}
              data-testid={`resolve-exit-${exit.value}`}
            />
            <span>
              <span className="font-medium">{exit.label}</span>
              <span className="block text-xs text-text-secondary">{exit.consequence}</span>
            </span>
          </label>
        ))}
      </div>

      {resolution === 'partial_refund' ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Refund amount (₹)" htmlFor="resolve-amount">
            <Input
              id="resolve-amount"
              inputMode="decimal"
              value={amountRupees}
              onChange={(event) => setAmountRupees(event.target.value)}
              placeholder="e.g. 500"
              data-testid="resolve-amount"
            />
          </Field>
          <Field label="Borne by" htmlFor="resolve-liability">
            <Select
              id="resolve-liability"
              value={liability}
              onChange={(event) => setLiability(event.target.value as DisputeLiability)}
              data-testid="resolve-liability"
            >
              <option value="driver">Driver</option>
              <option value="fleet">Fleet</option>
              <option value="platform">Platform (no compensating legs)</option>
            </Select>
          </Field>
        </div>
      ) : null}

      {resolution === 'cancel_no_charge' ? (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-brand"
            checked={compensateDriver}
            onChange={(event) => setCompensateDriver(event.target.checked)}
            data-testid="resolve-compensate"
          />
          <span>
            Compensate the driver from the platform
            <span className="block text-xs text-text-secondary">
              Posts a platform-funded compensation leg; the customer is charged nothing.
            </span>
          </span>
        </label>
      ) : null}

      <Field label="Resolution note (required)" htmlFor="resolve-note" className="mt-3">
        <Textarea
          id="resolve-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What was checked and why this exit is right — the audit trail and the customer notification both carry it."
          data-testid="resolve-note"
        />
      </Field>

      {errorMessage ? (
        <p className="mt-2 text-sm text-error" role="alert" data-testid="resolve-error">
          {errorMessage}
        </p>
      ) : null}

      <Button
        className="mt-3"
        onClick={() => void submit()}
        disabled={!noteReady || !amountReady || busy}
        data-testid="resolve-submit"
      >
        {busy ? 'Resolving…' : 'Resolve dispute'}
      </Button>
    </section>
  );
}
