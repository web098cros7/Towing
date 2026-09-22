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
  Textarea,
} from '@towing/web-ui';
import type { AppConfig } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useUpdateAppConfig } from '../api/adminDispatch.mutations';

/**
 * W12 — §19.8's minimum-supported-version gate and §19.9's SEV status banner.
 *
 * THE PREVIEW IS THE POINT. A banner is the closest thing this product has to a
 * broadcast: it reaches every customer with the app open, and it cannot be
 * unsent. The panel renders exactly what the handsets will show, from the values
 * the operator has typed, before anything is saved.
 *
 * RAISING AND CLEARING ARE TWO DIFFERENT SHAPES and the schema knows it: they
 * move together (level + message) to raise, and both arrive as `null` to clear.
 * A level with no message is refused by the schema AND by a DB CHECK, because a
 * banner with nothing to say is not a state anyone meant to create.
 */
export function AppConfigPanel({ config }: { config: AppConfig }) {
  const toast = useToast();
  const update = useUpdateAppConfig();
  const [form, setForm] = useState({
    minCustomerVersion: config.minCustomerVersion,
    minDriverVersion: config.minDriverVersion,
    forceUpgrade: String(config.forceUpgrade),
    sevLevel: config.sevLevel ?? '',
    sevMessage: config.sevMessage ?? '',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      minCustomerVersion: config.minCustomerVersion,
      minDriverVersion: config.minDriverVersion,
      forceUpgrade: String(config.forceUpgrade),
      sevLevel: config.sevLevel ?? '',
      sevMessage: config.sevMessage ?? '',
    });
  }, [config]);

  const semver = /^\d+\.\d+\.\d+$/;
  const versionsValid = semver.test(form.minCustomerVersion) && semver.test(form.minDriverVersion);
  const bannerValid =
    form.sevLevel === '' ? form.sevMessage.trim() === '' : form.sevMessage.trim().length >= 3;

  const saveGate = async () => {
    if (!versionsValid) return;
    setErrorMessage(null);
    try {
      await update.mutateAsync({
        minCustomerVersion: form.minCustomerVersion,
        minDriverVersion: form.minDriverVersion,
        forceUpgrade: form.forceUpgrade === 'true',
        reason: 'Version gate from the console',
      });
      toast('Version gate saved', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const publishBanner = async () => {
    if (form.sevLevel === '' || !bannerValid) return;
    setErrorMessage(null);
    try {
      await update.mutateAsync({
        sevLevel: form.sevLevel as 'sev1' | 'sev2' | 'sev3',
        sevMessage: form.sevMessage.trim(),
        reason: 'Incident banner from the console',
      });
      toast('Banner published — both apps show it on their next config read', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const clearBanner = async () => {
    setErrorMessage(null);
    try {
      await update.mutateAsync({ sevLevel: null, sevMessage: null, reason: 'Incident closed' });
      setForm((current) => ({ ...current, sevLevel: '', sevMessage: '' }));
      toast('Banner cleared', 'info');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const previewTone =
    form.sevLevel === 'sev1'
      ? 'bg-error-soft-bg text-error-soft-fg'
      : form.sevLevel === 'sev2'
        ? 'bg-warning-soft-bg text-warning-soft-fg'
        : 'bg-info-soft-bg text-info-soft-fg';

  return (
    <Card>
      <CardHeader>
        <CardTitle>App config &amp; status banner</CardTitle>
      </CardHeader>
      <CardContent>
        <h3 className="mb-2 text-sm font-semibold">Minimum supported versions (§19.8)</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Customer app" htmlFor="min-customer">
            <Input
              id="min-customer"
              value={form.minCustomerVersion}
              onChange={(event) =>
                setForm((current) => ({ ...current, minCustomerVersion: event.target.value }))
              }
              data-testid="min-customer-version"
            />
          </Field>
          <Field label="Driver app" htmlFor="min-driver">
            <Input
              id="min-driver"
              value={form.minDriverVersion}
              onChange={(event) =>
                setForm((current) => ({ ...current, minDriverVersion: event.target.value }))
              }
              data-testid="min-driver-version"
            />
          </Field>
          <Field label="Below minimum" htmlFor="force-upgrade">
            <Select
              id="force-upgrade"
              value={form.forceUpgrade}
              onChange={(event) =>
                setForm((current) => ({ ...current, forceUpgrade: event.target.value }))
              }
              data-testid="force-upgrade"
            >
              <option value="false">Warn, keep working</option>
              <option value="true">Block until updated</option>
            </Select>
          </Field>
        </div>
        <div className="mt-2">
          <Button
            variant="secondary"
            disabled={!versionsValid || update.isPending}
            onClick={() => void saveGate()}
            data-testid="appgate-save"
          >
            Save version gate
          </Button>
        </div>

        <h3 className="mt-5 mb-2 text-sm font-semibold">SEV banner (§19.9)</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Severity" htmlFor="sev-level">
            <Select
              id="sev-level"
              value={form.sevLevel}
              onChange={(event) =>
                setForm((current) => ({ ...current, sevLevel: event.target.value }))
              }
              data-testid="sev-level"
            >
              <option value="">No incident</option>
              <option value="sev1">SEV-1 — core down</option>
              <option value="sev2">SEV-2 — degraded</option>
              <option value="sev3">SEV-3 — minor</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Message" htmlFor="sev-message">
              <Textarea
                id="sev-message"
                value={form.sevMessage}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sevMessage: event.target.value }))
                }
                data-testid="sev-message"
              />
            </Field>
          </div>
        </div>

        <div
          className={
            form.sevLevel
              ? `mt-3 rounded-card px-3 py-2 text-sm ${previewTone}`
              : 'mt-3 rounded-card bg-surface1 px-3 py-2 text-sm text-text-secondary'
          }
          data-testid="sev-preview"
        >
          {form.sevLevel
            ? `${form.sevLevel.toUpperCase()}: ${form.sevMessage || '(no message yet)'}`
            : 'No banner is shown in the apps.'}
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            disabled={form.sevLevel === '' || !bannerValid || update.isPending}
            onClick={() => void publishBanner()}
            data-testid="sev-publish"
          >
            Publish banner
          </Button>
          <Button
            variant="ghost"
            disabled={config.sevLevel === null || update.isPending}
            onClick={() => void clearBanner()}
            data-testid="sev-clear"
          >
            Clear banner
          </Button>
        </div>

        {!bannerValid ? (
          <p className="mt-2 text-sm text-error" data-testid="sev-error">
            A banner needs a message of at least three characters.
          </p>
        ) : null}
        {errorMessage ? (
          <p className="mt-2 text-sm text-error" role="alert" data-testid="appconfig-error">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
