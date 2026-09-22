'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@towing/web-ui';
import type { AdminChargeConfig, AdminPricingConfig } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useUpdatePricing } from '../api/adminPricing.mutations';

/**
 * §7.4's charges and §7.4's surge percentages, plus the §19.2 fallback factor.
 *
 * SURGE IS MANUAL AT LAUNCH (decision G10). Nothing turns surge on — the
 * per-zone band is chosen by an operator in the zone editor (W13) and these two
 * numbers are what the band is worth. The copy says so, so nobody waits for an
 * automatic trigger that does not exist.
 *
 * SAVE SENDS A DIFF of the charge fields only, for the same reason the matrices
 * do: the operator's save must not overwrite an edit they never saw.
 */
export function ChargeSettingsForm({
  config,
  canEdit,
}: {
  config: AdminPricingConfig;
  canEdit: boolean;
}) {
  const toast = useToast();
  const update = useUpdatePricing();
  const [form, setForm] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Seed once per loaded config — editing must not fight a refetch.
  useEffect(() => {
    setForm({
      nightPct: String(config.charges.nightPct),
      nightStart: String(config.charges.nightStartHour),
      nightEnd: String(config.charges.nightEndHour),
      highway: (config.charges.highwayChargePaise / 100).toString(),
      accident: (config.charges.accidentChargePaise / 100).toString(),
      waitingFree: String(config.charges.waitingFreeMinutes),
      waitingMinute: (config.charges.waitingPerMinutePaise / 100).toString(),
      roadFactor: String(config.charges.haversineRoadFactor),
      surgeHigh: String(config.charges.surgePctHigh),
      surgePeak: String(config.charges.surgePctPeak),
    });
  }, [config]);

  const value = (key: string): number => Number(form[key]);
  const isNumber = (key: string): boolean => Number.isFinite(value(key));

  const hourValid = (key: string): boolean => isNumber(key) && value(key) >= 0 && value(key) <= 23;
  const pctValid = (key: string): boolean => isNumber(key) && value(key) >= 0 && value(key) <= 100;

  const windowValid =
    hourValid('nightStart') && hourValid('nightEnd') && value('nightStart') !== value('nightEnd');

  const canSave =
    Boolean(config) &&
    !update.isPending &&
    windowValid &&
    ['nightPct', 'surgeHigh', 'surgePeak'].every(pctValid) &&
    ['highway', 'accident', 'waitingMinute'].every((key) => isNumber(key) && value(key) >= 0) &&
    ['waitingFree'].every((key) => isNumber(key) && value(key) >= 0) &&
    isNumber('roadFactor') &&
    value('roadFactor') >= 1 &&
    value('roadFactor') <= 3;

  const save = async () => {
    if (!canSave) return;
    setErrorMessage(null);

    const current = config.charges;
    const patch: Partial<AdminChargeConfig> = {};
    const toPaise = (key: string) => Math.round(value(key) * 100);

    if (value('nightPct') !== current.nightPct) patch.nightPct = value('nightPct');
    if (value('nightStart') !== current.nightStartHour) {
      patch.nightStartHour = Math.round(value('nightStart'));
    }
    if (value('nightEnd') !== current.nightEndHour) {
      patch.nightEndHour = Math.round(value('nightEnd'));
    }
    if (toPaise('highway') !== current.highwayChargePaise)
      patch.highwayChargePaise = toPaise('highway');
    if (toPaise('accident') !== current.accidentChargePaise) {
      patch.accidentChargePaise = toPaise('accident');
    }
    if (value('waitingFree') !== current.waitingFreeMinutes) {
      patch.waitingFreeMinutes = Math.round(value('waitingFree'));
    }
    if (toPaise('waitingMinute') !== current.waitingPerMinutePaise) {
      patch.waitingPerMinutePaise = toPaise('waitingMinute');
    }
    if (value('roadFactor') !== current.haversineRoadFactor) {
      patch.haversineRoadFactor = value('roadFactor');
    }
    if (value('surgeHigh') !== current.surgePctHigh) patch.surgePctHigh = value('surgeHigh');
    if (value('surgePeak') !== current.surgePctPeak) patch.surgePctPeak = value('surgePeak');

    if (Object.keys(patch).length === 0) {
      toast('Nothing changed', 'info');
      return;
    }

    try {
      await update.mutateAsync({ charges: patch });
      toast('Charges saved — effective on the next fare', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const money = (key: string, label: string, hint: string) => (
    <Field label={label} htmlFor={`charges-${key}`}>
      <Input
        id={`charges-${key}`}
        inputMode="decimal"
        value={form[key] ?? ''}
        disabled={!canEdit}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        data-testid={`charges-${kebab(key)}`}
      />
      <span className="mt-1 block text-xs text-text-tertiary">{hint}</span>
    </Field>
  );

  const count = (key: string, label: string, hint: string) => (
    <Field label={label} htmlFor={`charges-${key}`}>
      <Input
        id={`charges-${key}`}
        inputMode="numeric"
        value={form[key] ?? ''}
        disabled={!canEdit}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        data-testid={`charges-${kebab(key)}`}
      />
      <span className="mt-1 block text-xs text-text-tertiary">{hint}</span>
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Charges &amp; night window</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Night surcharge (percent)" htmlFor="charges-nightPct">
              <Input
                id="charges-nightPct"
                inputMode="decimal"
                value={form.nightPct ?? ''}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((current) => ({ ...current, nightPct: event.target.value }))
                }
                data-testid="charges-night-pct"
              />
            </Field>
            {count(
              'nightStart',
              'Night starts (hour, IST)',
              '22 means 10 pm. The window wraps midnight.',
            )}
            {count('nightEnd', 'Night ends (hour, IST)', '6 means 6 am.')}
            {money(
              'highway',
              'Highway pickup (₹)',
              '§7.4 gives ₹500–₹1,000; charged when the pickup is in a highway zone.',
            )}
            {money(
              'accident',
              'Accident recovery (₹)',
              'Added when the service is accident recovery.',
            )}
            {count('waitingFree', 'Waiting free (minutes)', 'Before the waiting charge starts.')}
            {money('waitingMinute', 'Waiting per minute (₹)', 'After the free window.')}
            {money(
              'roadFactor',
              'Straight-line road factor',
              'Multiplier when the routing provider is unavailable (§19.2). Between 1 and 3.',
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Surge percentages</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-text-secondary">
            Surge is manual at launch (decision G10): an operator sets a zone&rsquo;s band in the
            zone editor, and these are what each band is worth. <strong>Standard</strong> is always
            no surge.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="High band (percent)" htmlFor="charges-surgeHigh">
              <Input
                id="charges-surgeHigh"
                inputMode="decimal"
                value={form.surgeHigh ?? ''}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((current) => ({ ...current, surgeHigh: event.target.value }))
                }
                data-testid="surge-high-pct"
              />
            </Field>
            <Field label="Peak band (percent)" htmlFor="charges-surgePeak">
              <Input
                id="charges-surgePeak"
                inputMode="decimal"
                value={form.surgePeak ?? ''}
                disabled={!canEdit}
                onChange={(event) =>
                  setForm((current) => ({ ...current, surgePeak: event.target.value }))
                }
                data-testid="surge-peak-pct"
              />
            </Field>
          </div>

          {!windowValid ? (
            <p className="mt-3 text-sm text-error" data-testid="charges-window-error">
              The night window needs two different hours between 0 and 23.
            </p>
          ) : null}
          {errorMessage ? (
            <p className="mt-3 text-sm text-error" role="alert" data-testid="charges-error">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-4">
            <Button
              onClick={() => void save()}
              disabled={!canEdit || !canSave}
              data-testid="charges-save"
            >
              {update.isPending ? 'Saving…' : 'Save charges'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** camelCase keys → the console's kebab-case testids (`nightEnd` → `night-end`). */
function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
