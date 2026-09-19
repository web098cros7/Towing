'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from '@towing/web-ui';
import { serviceTypeSchema, type AdminDispatchConfig, type AdminDispatchConfigUpdate } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useUpdateDispatchConfig } from '../api/adminDispatch.mutations';

/**
 * §6.2's scorer weights, §6.1's stale threshold, §6.7's toggles — and W12's
 * re-dispatch priority, ping cadence and platform per-service offers.
 *
 * THE WEIGHTS SUM TO 100 AND THE FORM SAYS SO BEFORE THE SERVER DOES. The DB
 * CHECK is the backstop (`ck_dispatch_config_weights_sum`), the schema is the
 * second, and this validator is the one that tells an operator what they have
 * typed rather than what they typed wrong.
 *
 * SAVE SENDS A DIFF: only keys whose value changed.
 */
export function DispatchGlobalForm({ config }: { config: AdminDispatchConfig }) {
  const toast = useToast();
  const update = useUpdateDispatchConfig();
  const [form, setForm] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const global = config.global;
    setForm({
      proximity: String(global.weights.proximity),
      rating: String(global.weights.rating),
      acceptance: String(global.weights.acceptance),
      completion: String(global.weights.completion),
      stalePingSeconds: String(global.stalePingSeconds),
      pingOnJobMs: String(global.pingOnJobMs),
      pingIdleMs: String(global.pingIdleMs),
      oneActiveBookingPerCustomer: String(global.oneActiveBookingPerCustomer),
      blockOnUnpaidBalance: String(global.blockOnUnpaidBalance),
      redispatchPriority: global.redispatchPriority,
      ...Object.fromEntries(
        serviceTypeSchema.options.map((service) => [
          `offers-${service}`,
          global.perServiceMaxOffers?.[service] === undefined
            ? ''
            : String(global.perServiceMaxOffers[service]),
        ]),
      ),
    });
  }, [config]);

  const number = (key: string): number => Number(form[key]);
  const weightSum =
    number('proximity') + number('rating') + number('acceptance') + number('completion');
  const weightsValid = Math.abs(weightSum - 100) < 0.005;

  const offersValid = serviceTypeSchema.options.every((service) => {
    const raw = form[`offers-${service}`];
    if (raw === undefined || raw === '') return true;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10;
  });

  const cadenceValid = ['pingOnJobMs', 'pingIdleMs'].every((key) => {
    const parsed = number(key);
    return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 300_000;
  });

  const canSave = weightsValid && offersValid && cadenceValid && !update.isPending;

  const offers = Object.fromEntries(
    serviceTypeSchema.options
      .map((service) => [service, form[`offers-${service}`]] as const)
      .filter(([, raw]) => raw !== undefined && raw !== '')
      .map(([service, raw]) => [service, Number(raw)]),
  );
  const offersUnchanged =
    JSON.stringify(offers) === JSON.stringify(config.global.perServiceMaxOffers ?? {});

  const save = async () => {
    if (!canSave) return;
    setErrorMessage(null);

    const patch: AdminDispatchConfigUpdate = {};
    const global = config.global;

    const weights = {
      proximity: number('proximity'),
      rating: number('rating'),
      acceptance: number('acceptance'),
      completion: number('completion'),
    };
    const weightsChanged = (['proximity', 'rating', 'acceptance', 'completion'] as const).some(
      (key) => weights[key] !== global.weights[key],
    );
    if (weightsChanged) patch.weights = weights;

    if (number('stalePingSeconds') !== global.stalePingSeconds) {
      patch.stalePingSeconds = number('stalePingSeconds');
    }
    if (number('pingOnJobMs') !== global.pingOnJobMs) patch.pingOnJobMs = number('pingOnJobMs');
    if (number('pingIdleMs') !== global.pingIdleMs) patch.pingIdleMs = number('pingIdleMs');
    if (form.redispatchPriority !== global.redispatchPriority) {
      patch.redispatchPriority = form.redispatchPriority as AdminDispatchConfigUpdate['redispatchPriority'];
    }
    if (form.oneActiveBookingPerCustomer !== String(global.oneActiveBookingPerCustomer)) {
      patch.oneActiveBookingPerCustomer = form.oneActiveBookingPerCustomer === 'true';
    }
    if (form.blockOnUnpaidBalance !== String(global.blockOnUnpaidBalance)) {
      patch.blockOnUnpaidBalance = form.blockOnUnpaidBalance === 'true';
    }
    if (!offersUnchanged) {
      // All-empty means "no platform per-service offers", which is an explicit
      // null rather than a silently-ignored empty object.
      patch.perServiceMaxOffers = Object.keys(offers).length > 0 ? offers : null;
    }

    if (Object.keys(patch).length === 0) {
      toast('Nothing changed', 'info');
      return;
    }

    try {
      await update.mutateAsync(patch);
      toast('Dispatch config saved — effective on the next wave', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispatch parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <h3 className="mb-2 text-sm font-semibold">Scorer weights (§6.2)</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['proximity', 'rating', 'acceptance', 'completion'] as const).map((key) => (
            <Field key={key} label={key} htmlFor={`weight-${key}`}>
              <Input
                id={`weight-${key}`}
                inputMode="numeric"
                value={form[key] ?? ''}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                data-testid={`weight-${key}`}
              />
            </Field>
          ))}
        </div>
        <p
          className={weightsValid ? 'mt-2 text-xs text-text-tertiary' : 'mt-2 text-sm text-error'}
          data-testid="weights-sum"
        >
          Total: {Number.isFinite(weightSum) ? weightSum : '—'} / 100
          {weightsValid ? '' : ' — the scorer normalises against 100, so this must be exact.'}
        </p>

        <h3 className="mt-4 mb-2 text-sm font-semibold">Liveness &amp; cadence</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Stale ping (seconds)" htmlFor="stale-ping">
            <Input
              id="stale-ping"
              inputMode="numeric"
              value={form.stalePingSeconds ?? ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, stalePingSeconds: event.target.value }))
              }
              data-testid="stale-ping"
            />
          </Field>
          <Field label="Ping on a job (ms)" htmlFor="ping-on-job">
            <Input
              id="ping-on-job"
              inputMode="numeric"
              value={form.pingOnJobMs ?? ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, pingOnJobMs: event.target.value }))
              }
              data-testid="ping-on-job"
            />
          </Field>
          <Field label="Ping when idle (ms)" htmlFor="ping-idle">
            <Input
              id="ping-idle"
              inputMode="numeric"
              value={form.pingIdleMs ?? ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, pingIdleMs: event.target.value }))
              }
              data-testid="ping-idle"
            />
          </Field>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          Pushed to handsets over `config:update`. Keep the idle cadence under the 15 s stale
          threshold or a live driver reads as offline to dispatch.
        </p>

        <h3 className="mt-4 mb-2 text-sm font-semibold">§6.5 re-dispatch</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Re-dispatch priority" htmlFor="redispatch-priority">
            <Select
              id="redispatch-priority"
              value={form.redispatchPriority ?? 'front'}
              onChange={(event) =>
                setForm((current) => ({ ...current, redispatchPriority: event.target.value }))
              }
              data-testid="redispatch-priority"
            >
              <option value="front">Front of the queue (delay 0)</option>
              <option value="normal">Next cadence (wait a wave)</option>
            </Select>
          </Field>
        </div>

        <h3 className="mt-4 mb-2 text-sm font-semibold">Offers per wave, per service</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {serviceTypeSchema.options.map((service) => (
            <Field key={service} label={service.replace(/_/g, ' ')} htmlFor={`offers-${service}`}>
              <Input
                id={`offers-${service}`}
                inputMode="numeric"
                placeholder="zone default"
                value={form[`offers-${service}`] ?? ''}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [`offers-${service}`]: event.target.value }))
                }
                data-testid={`offers-${service}`}
              />
            </Field>
          ))}
        </div>

        <h3 className="mt-4 mb-2 text-sm font-semibold">Booking guards (§3.8)</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="One active booking per customer" htmlFor="one-active">
            <Select
              id="one-active"
              value={form.oneActiveBookingPerCustomer ?? 'true'}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  oneActiveBookingPerCustomer: event.target.value,
                }))
              }
              data-testid="one-active-booking"
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </Select>
          </Field>
          <Field label="Block bookings on an unpaid balance" htmlFor="block-unpaid">
            <Select
              id="block-unpaid"
              value={form.blockOnUnpaidBalance ?? 'true'}
              onChange={(event) =>
                setForm((current) => ({ ...current, blockOnUnpaidBalance: event.target.value }))
              }
              data-testid="block-unpaid"
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </Select>
          </Field>
        </div>

        {!offersValid ? (
          <p className="mt-3 text-sm text-error" data-testid="offers-error">
            Offers per wave must be a whole number between 1 and 10, or blank to inherit.
          </p>
        ) : null}
        {!cadenceValid ? (
          <p className="mt-3 text-sm text-error" data-testid="cadence-error">
            The ping cadence must be between 1,000 and 300,000 ms.
          </p>
        ) : null}
        {errorMessage ? (
          <p className="mt-3 text-sm text-error" role="alert" data-testid="dispatch-error">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-4">
          <Button
            onClick={() => void save()}
            disabled={!canSave}
            data-testid="dispatch-save"
          >
            {update.isPending ? 'Saving…' : 'Save dispatch config'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
