'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Field, Input } from '@towing/web-ui';
import type { FleetDriverPerformance } from '@towing/api-contracts';
import { useUpdateDriverShare } from '../api/drivers.queries';

/**
 * 0042: this driver's share of each job. Under the fleet's `share` model the
 * owner can give one driver a different figure from the default; under
 * `salary` there is nothing per driver to set, so the section says so and
 * points at Settings. Applies to jobs accepted from now on.
 */
export function DriverShareSection({
  driverId,
  name,
  pay,
}: {
  driverId: string;
  name: string;
  pay: FleetDriverPerformance['pay'];
}) {
  const effective = pay.overridePct ?? pay.fleetDefaultPct;
  const [pct, setPct] = useState(String(effective));
  const update = useUpdateDriverShare(driverId);

  useEffect(() => {
    setPct(String(pay.overridePct ?? pay.fleetDefaultPct));
  }, [pay.overridePct, pay.fleetDefaultPct]);

  if (pay.model === 'salary') {
    return (
      <section data-testid="driver-share">
        <h3 className="mb-1 text-sm font-semibold">Pay</h3>
        <p className="text-sm text-text-secondary">
          Your fleet keeps the payout for every job and pays {name} a salary. Change this in{' '}
          <Link href="/settings" className="underline">
            Settings
          </Link>
          .
        </p>
      </section>
    );
  }

  const value = Number(pct);
  const error =
    pct.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100
      ? 'Enter a number from 0 to 100'
      : undefined;

  return (
    <section data-testid="driver-share">
      <h3 className="mb-1 text-sm font-semibold">Pay</h3>
      <p className="mb-2 text-xs text-text-tertiary">
        {pay.overridePct === null
          ? `${name} gets your fleet's default share: ${pay.fleetDefaultPct}% of each job.`
          : `${name} gets ${pay.overridePct}% of each job. Your fleet's default is ${pay.fleetDefaultPct}%.`}{' '}
        Changes apply to jobs accepted from now on.
      </p>
      <Field
        label={`${name}'s share of each job (%)`}
        htmlFor="driver-share-override"
        error={error}
      >
        <Input
          id="driver-share-override"
          inputMode="decimal"
          value={pct}
          onChange={(event) => setPct(event.target.value)}
          disabled={update.isPending}
        />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => update.mutate(value)}
          disabled={update.isPending || error !== undefined || value === effective}
        >
          {update.isPending ? 'Saving…' : 'Save share'}
        </Button>
        {pay.overridePct !== null ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update.mutate(null)}
            disabled={update.isPending}
          >
            Use fleet default
          </Button>
        ) : null}
        {update.isError ? (
          <p role="alert" className="text-xs text-error">
            Could not save. Try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}
