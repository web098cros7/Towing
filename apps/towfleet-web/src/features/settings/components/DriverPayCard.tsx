'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@towing/web-ui';
import type { FleetDriverPay } from '@towing/api-contracts';
import { useUpdateDriverPay } from '../api/settings.queries';
import type { FleetSettings } from '../types';

const MODELS: ReadonlyArray<{
  value: FleetDriverPay['model'];
  label: string;
  description: string;
}> = [
  {
    value: 'share',
    label: 'Share each job',
    description: 'Each driver gets a percentage of every job they do. Your fleet keeps the rest.',
  },
  {
    value: 'salary',
    label: 'Keep it all, pay a salary',
    description:
      'Your fleet receives the whole payout for every job. You pay your drivers yourself, outside MiTow.',
  },
];

/**
 * 0042 (Ehsan, 24 Sep): the owner decides how their drivers are paid. The
 * change applies to jobs accepted AFTER saving: each job locks its split when
 * the driver accepts it, and the driver sees that split on the offer.
 */
export function DriverPayCard({ settings }: { settings: FleetSettings }) {
  const [model, setModel] = useState(settings.driverPay.model);
  const [pct, setPct] = useState(String(settings.driverPay.driverSharePct));
  const [saved, setSaved] = useState(false);
  const update = useUpdateDriverPay();

  useEffect(() => {
    setModel(settings.driverPay.model);
    setPct(String(settings.driverPay.driverSharePct));
  }, [settings]);

  const pctNumber = Number(pct);
  const pctError =
    model === 'share' &&
    (pct.trim() === '' || !Number.isFinite(pctNumber) || pctNumber < 0 || pctNumber > 100)
      ? 'Enter a number from 0 to 100'
      : undefined;
  const dirty =
    model !== settings.driverPay.model || pctNumber !== settings.driverPay.driverSharePct;

  return (
    <Card data-testid="driver-pay-card">
      <CardHeader>
        <CardTitle>How your drivers are paid</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Pay model</legend>
          {MODELS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-input border border-border px-3 py-2.5"
            >
              <input
                type="radio"
                name="driver-pay-model"
                value={option.value}
                checked={model === option.value}
                onChange={() => {
                  setSaved(false);
                  setModel(option.value);
                }}
                disabled={update.isPending}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-text-tertiary">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {model === 'share' ? (
          <Field label="Driver's share of each job (%)" htmlFor="driver-share-pct" error={pctError}>
            <Input
              id="driver-share-pct"
              inputMode="decimal"
              value={pct}
              onChange={(event) => {
                setSaved(false);
                setPct(event.target.value);
              }}
              disabled={update.isPending}
            />
          </Field>
        ) : null}

        <p className="text-xs text-text-tertiary">
          Applies to jobs accepted from now on. You can give one driver a different share from their
          panel on the Drivers page.
        </p>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              setSaved(false);
              update.mutate(
                { model, driverSharePct: pctError ? settings.driverPay.driverSharePct : pctNumber },
                { onSuccess: () => setSaved(true) },
              );
            }}
            disabled={update.isPending || !dirty || pctError !== undefined}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          {saved && !update.isPending ? (
            <p role="status" className="text-xs text-success-soft-fg">
              Saved
            </p>
          ) : null}
          {update.isError ? (
            <p role="alert" className="text-xs text-error">
              Could not save. Try again.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
