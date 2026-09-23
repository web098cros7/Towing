'use client';

import { useState } from 'react';
import { Field, Select, Textarea } from '@towing/web-ui';
import {
  DEFAULT_BEARER_BY_CAUSE,
  REFUND_BEARERS,
  REFUND_CAUSES,
  type PartialRefundTerms,
  type RefundBearer,
  type RefundCause,
  type RefundDelivery,
} from '@towing/api-contracts';

/**
 * What an admin sees for each cause. The words are the question they can
 * answer from the case in front of them, not the policy behind it.
 */
const CAUSE_LABELS: Record<RefundCause, string> = {
  fare_error: 'The fare was wrong (longer route, extra waiting, wrong toll)',
  platform_error: 'Our mistake (bad estimate, app or pricing problem)',
  goodwill: 'Goodwill (the customer is unhappy, nobody clearly at fault)',
  driver_misconduct: "The driver's conduct (rude, unsafe, job not done properly)",
};

/** Who pays, in the words the console uses everywhere a refund is shown. */
export const BEARER_LABELS: Record<RefundBearer, string> = {
  shared: 'Shared: the driver gives back their share of the fare, MiTow its commission',
  platform: 'MiTow pays all of it; the driver keeps every rupee',
  provider: 'The driver pays all of it (never more than this trip paid them)',
};

/** The short form, for lists and the dispute summary. */
export function bearerShortLabel(liability: string | null): string | null {
  switch (liability) {
    case 'shared':
      return 'shared';
    case 'platform':
      return 'MiTow';
    case 'provider':
      return 'driver';
    // Refunds issued before ADM-6 named one party by hand.
    case 'driver':
      return 'driver';
    case 'fleet':
      return 'fleet';
    default:
      return null;
  }
}

export interface RefundTermsState {
  terms: PartialRefundTerms;
  /** False while an override is chosen without its written reason. */
  valid: boolean;
}

/**
 * ADM-6's form half: the admin picks WHY, and the policy says who pays.
 *
 * The override is folded away behind a link on purpose. The cause's default
 * is the rule MiTow applies to everyone, and changing it is the exception that
 * has to be explained, so it should take a deliberate step, not sit beside the
 * cause as an equal choice. Damage to the customer's car has no option here at
 * all: that is an insurance claim, not a refund.
 */
export function RefundTermsFields({
  idPrefix,
  onChange,
}: {
  idPrefix: string;
  onChange: (state: RefundTermsState) => void;
}) {
  const [cause, setCause] = useState<RefundCause>('fare_error');
  const [overriding, setOverriding] = useState(false);
  const [bearer, setBearer] = useState<RefundBearer>(DEFAULT_BEARER_BY_CAUSE.fare_error);
  const [overrideReason, setOverrideReason] = useState('');
  const [delivery, setDelivery] = useState<RefundDelivery>('original');

  const emit = (next: {
    cause: RefundCause;
    overriding: boolean;
    bearer: RefundBearer;
    overrideReason: string;
    delivery: RefundDelivery;
  }) => {
    const isOverride = next.overriding && next.bearer !== DEFAULT_BEARER_BY_CAUSE[next.cause];
    onChange({
      terms: {
        cause: next.cause,
        delivery: next.delivery,
        ...(isOverride ? { bearer: next.bearer, overrideReason: next.overrideReason.trim() } : {}),
      },
      valid: !isOverride || next.overrideReason.trim().length >= 10,
    });
  };

  const current = { cause, overriding, bearer, overrideReason, delivery };
  const defaultBearer = DEFAULT_BEARER_BY_CAUSE[cause];

  return (
    <>
      <Field label="Why is the customer being refunded?" htmlFor={`${idPrefix}-cause`}>
        <Select
          id={`${idPrefix}-cause`}
          value={cause}
          onChange={(event) => {
            const next = event.target.value as RefundCause;
            setCause(next);
            // A new cause resets the override: the admin chose to depart from
            // the OLD cause's rule, not from this one's.
            setOverriding(false);
            setBearer(DEFAULT_BEARER_BY_CAUSE[next]);
            setOverrideReason('');
            emit({
              ...current,
              cause: next,
              overriding: false,
              bearer: DEFAULT_BEARER_BY_CAUSE[next],
              overrideReason: '',
            });
          }}
          data-testid={`${idPrefix}-cause`}
        >
          {REFUND_CAUSES.map((value) => (
            <option key={value} value={value}>
              {CAUSE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      {overriding ? (
        <>
          <Field label="Who pays (changed from the usual rule)" htmlFor={`${idPrefix}-bearer`}>
            <Select
              id={`${idPrefix}-bearer`}
              value={bearer}
              onChange={(event) => {
                const next = event.target.value as RefundBearer;
                setBearer(next);
                emit({ ...current, bearer: next });
              }}
              data-testid={`${idPrefix}-bearer`}
            >
              {REFUND_BEARERS.map((value) => (
                <option key={value} value={value}>
                  {BEARER_LABELS[value]}
                  {value === defaultBearer ? ' (usual for this reason)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {bearer !== defaultBearer ? (
            <Field
              label="Why are you changing who pays? (required, at least 10 characters)"
              htmlFor={`${idPrefix}-override-reason`}
            >
              <Textarea
                id={`${idPrefix}-override-reason`}
                value={overrideReason}
                onChange={(event) => {
                  setOverrideReason(event.target.value);
                  emit({ ...current, overrideReason: event.target.value });
                }}
                placeholder="This goes on the refund and in the audit trail."
                data-testid={`${idPrefix}-override-reason`}
              />
            </Field>
          ) : null}
        </>
      ) : (
        <div className="text-sm" data-testid={`${idPrefix}-who-pays`}>
          <p>
            <span className="text-text-secondary">Who pays: </span>
            {BEARER_LABELS[defaultBearer]}
          </p>
          <button
            type="button"
            className="mt-1 text-xs text-brand underline"
            onClick={() => {
              setOverriding(true);
              emit({ ...current, overriding: true });
            }}
            data-testid={`${idPrefix}-override`}
          >
            Change who pays
          </button>
        </div>
      )}

      <Field label="Send the money" htmlFor={`${idPrefix}-delivery`}>
        <Select
          id={`${idPrefix}-delivery`}
          value={delivery}
          onChange={(event) => {
            const next = event.target.value as RefundDelivery;
            setDelivery(next);
            emit({ ...current, delivery: next });
          }}
          data-testid={`${idPrefix}-delivery`}
        >
          <option value="original">Back the way they paid (card or UPI refund)</option>
          <option value="wallet">
            As MiTow wallet credit (instant, usable on the next booking)
          </option>
        </Select>
      </Field>
      <p className="-mt-2 text-xs text-text-tertiary">
        A cash trip always refunds to the wallet: the driver already holds the notes.
      </p>
    </>
  );
}
