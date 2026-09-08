'use client';

import { useEffect, useState } from 'react';
import { fleetSettingsUpdateSchema } from '@towing/api-contracts';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@towing/web-ui';
import { ApiError } from '@/lib/apiClient';
import { useUpdateSettings } from '../api/settings.queries';
import type { FleetSettings } from '../types';

/**
 * §9.3.1's business profile: name, GSTIN (optional), address.
 *
 * **No form library.** The three existing client-side validation sites in this
 * app (the login page and `features/trucks/api/imports.ts`) call
 * `schema.safeParse` directly, and adding react-hook-form for two forms would
 * be a new dependency and a second idiom. The same
 * `fleetSettingsUpdateSchema` the server validates with runs here, so the two
 * cannot disagree about what a valid GSTIN is.
 *
 * Client validation is a courtesy, never a trust boundary — a server 422 is
 * merged into the same field-error map, which makes `ApiError.details` its
 * first consumer in the app.
 */
export function BusinessProfileForm({
  settings,
  onSaved,
  submitLabel = 'Save changes',
}: {
  settings: FleetSettings;
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [gstin, setGstin] = useState(settings.gstin ?? '');
  const [address, setAddress] = useState(settings.address ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const update = useUpdateSettings();

  useEffect(() => {
    setBusinessName(settings.businessName);
    setGstin(settings.gstin ?? '');
    setAddress(settings.address ?? '');
  }, [settings]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setSaved(false);

    const patch = {
      businessName,
      // Empty means "no GSTIN" (§9.3.1 makes it optional), not an empty string.
      gstin: gstin.trim() === '' ? null : gstin.trim().toUpperCase(),
      address: address.trim() === '' ? null : address.trim(),
    };

    const parsed = fleetSettingsUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    update.mutate(parsed.data, {
      onSuccess: () => {
        setSaved(true);
        onSaved?.();
      },
      onError: (error) => {
        if (error instanceof ApiError && error.details) {
          setErrors(fieldErrors(error.details as ZodLikeIssue[]));
        } else {
          setErrors({ _: error instanceof Error ? error.message : 'Could not save your changes' });
        }
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Business name" htmlFor="bizName" error={errors.businessName}>
            <Input
              id="bizName"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={update.isPending}
            />
          </Field>
          <Field label="GSTIN (optional)" htmlFor="gstin" error={errors.gstin}>
            <Input
              id="gstin"
              value={gstin}
              placeholder="29ABCDE1234F1Z5"
              onChange={(e) => setGstin(e.target.value)}
              disabled={update.isPending}
            />
          </Field>
          <Field label="Registered address" htmlFor="address" error={errors.address}>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={update.isPending}
            />
          </Field>

          {errors._ ? <p className="text-xs text-error">{errors._}</p> : null}

          <div className="flex items-center gap-3">
            <button type="submit" hidden aria-hidden />
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : submitLabel}
            </Button>
            {saved && !update.isPending ? (
              <p role="status" className="text-xs text-success-soft-fg">
                Saved
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface ZodLikeIssue {
  path?: (string | number)[];
  message?: string;
}

/** Zod issues (or the server's `details`, which is the same shape) → field map. */
function fieldErrors(issues: unknown): Record<string, string> {
  if (!Array.isArray(issues)) return {};

  const out: Record<string, string> = {};
  for (const issue of issues as ZodLikeIssue[]) {
    const key = issue.path?.[0] !== undefined ? String(issue.path[0]) : '_';
    out[key] ??= issue.message ?? 'Invalid value';
  }
  return out;
}
