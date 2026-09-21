'use client';

import { useState } from 'react';
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
import type { AdminDispatchConfig } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useUpdateZoneOverride } from '../api/adminDispatch.mutations';

/**
 * §6.7's per-zone ladder, showing OVERRIDE and RESOLVED side by side.
 *
 * THE FORM SUBMITS THE OVERRIDE, NEVER THE RESOLVED VALUES. That distinction is
 * the whole reason the API returns both: saving a form pre-filled with resolved
 * values would write the code defaults as explicit overrides the first time an
 * operator touched anything, and that zone would then silently stop tracking
 * every future change to those defaults.
 *
 * Clearing is its own button because `null` means "back to the platform
 * defaults", which is different from omitting the zone (leave it alone) — an
 * operator must be able to undo a bad ladder without knowing what the defaults
 * were.
 */
export function ZoneLadderTable({ config }: { config: AdminDispatchConfig }) {
  const toast = useToast();
  const update = useUpdateZoneOverride();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const draftFor = (zoneId: string, fallback: Record<string, unknown>): Record<string, string> =>
    drafts[zoneId] ?? Object.fromEntries(Object.entries(fallback).map(([k, v]) => [k, String(v)]));

  const setDraft = (zoneId: string, key: string, value: string) => {
    // Editing is an attempt to fix what the error was about — keeping the
    // complaint on screen while the operator corrects it is noise.
    setErrorMessage(null);
    setDrafts((current) => ({
      ...current,
      [zoneId]: { ...(current[zoneId] ?? {}), [key]: value },
    }));
  };

  const save = async (zone: AdminDispatchConfig['zones'][number]) => {
    setErrorMessage(null);
    const draft = drafts[zone.zoneId];
    if (!draft) return;

    const ladder = (draft.radiusLadderKm ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    const ascending = ladder.every((value, index) => index === 0 || value > ladder[index - 1]!);
    if (ladder.length === 0 || !ascending) {
      setErrorMessage('The ladder must be ascending kilometres, e.g. 2, 4, 7, 10, 15.');
      return;
    }

    const override = {
      radiusLadderKm: ladder,
      ...(draft.offersPerWave ? { offersPerWave: Number(draft.offersPerWave) } : {}),
      ...(draft.offerTimeoutSeconds
        ? { offerTimeoutSeconds: Number(draft.offerTimeoutSeconds) }
        : {}),
      ...(draft.maxSearchSeconds ? { maxSearchSeconds: Number(draft.maxSearchSeconds) } : {}),
    };

    try {
      await update.mutateAsync({ zoneId: zone.zoneId, override });
      setDrafts((current) => {
        const next = { ...current };
        delete next[zone.zoneId];
        return next;
      });
      toast(`${zone.zoneName}: ladder saved`, 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const clear = async (zone: AdminDispatchConfig['zones'][number]) => {
    setErrorMessage(null);
    try {
      await update.mutateAsync({ zoneId: zone.zoneId, override: null });
      toast(`${zone.zoneName}: back to the platform defaults`, 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-zone ladders</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary">
          Editing a field pins it as an override for that zone. A zone with no override keeps
          tracking the defaults above.
        </p>

        <div className="space-y-4">
          {config.zones.map((zone) => {
            const source = zone.override ?? {
              radiusLadderKm: zone.resolved.radiusLadderKm,
              offersPerWave: zone.resolved.offersPerWave,
              offerTimeoutSeconds: zone.resolved.offerTimeoutSeconds,
              maxSearchSeconds: zone.resolved.maxSearchSeconds,
            };
            const draft = draftFor(zone.zoneId, source as Record<string, unknown>);

            return (
              <div
                key={zone.zoneId}
                className="rounded-card border border-border p-3"
                data-testid={`zone-${zone.zoneName.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-semibold">{zone.zoneName}</span>
                  <Badge variant={zone.override ? 'brand' : 'neutral'}>
                    {zone.override ? 'override' : 'defaults'}
                  </Badge>
                  {!zone.isActive ? <Badge variant="warning">inactive</Badge> : null}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <Field label="Ladder (km, ascending)" htmlFor={`ladder-${zone.zoneId}`}>
                    <Input
                      id={`ladder-${zone.zoneId}`}
                      value={
                        draft.radiusLadderKm ??
                        String((source as { radiusLadderKm: number[] }).radiusLadderKm.join(', '))
                      }
                      onChange={(event) =>
                        setDraft(zone.zoneId, 'radiusLadderKm', event.target.value)
                      }
                      data-testid={`ladder-${zone.zoneName.replace(/\s+/g, '-').toLowerCase()}`}
                    />
                  </Field>
                  <Field label="Offers per wave" htmlFor={`offers-${zone.zoneId}`}>
                    <Input
                      id={`offers-${zone.zoneId}`}
                      inputMode="numeric"
                      value={draft.offersPerWave ?? ''}
                      onChange={(event) =>
                        setDraft(zone.zoneId, 'offersPerWave', event.target.value)
                      }
                      data-testid={`zone-offers-${zone.zoneName.replace(/\s+/g, '-').toLowerCase()}`}
                    />
                  </Field>
                  <Field label="Offer timeout (s)" htmlFor={`timeout-${zone.zoneId}`}>
                    <Input
                      id={`timeout-${zone.zoneId}`}
                      inputMode="numeric"
                      value={draft.offerTimeoutSeconds ?? ''}
                      onChange={(event) =>
                        setDraft(zone.zoneId, 'offerTimeoutSeconds', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Max search (s)" htmlFor={`search-${zone.zoneId}`}>
                    <Input
                      id={`search-${zone.zoneId}`}
                      inputMode="numeric"
                      value={draft.maxSearchSeconds ?? ''}
                      onChange={(event) =>
                        setDraft(zone.zoneId, 'maxSearchSeconds', event.target.value)
                      }
                    />
                  </Field>
                </div>

                <p className="mt-2 text-xs text-text-tertiary">
                  Resolved today: {zone.resolved.radiusLadderKm.join(' / ')} km ·{' '}
                  {zone.resolved.offersPerWave} offers · {zone.resolved.offerTimeoutSeconds}s
                  countdown · {zone.resolved.maxSearchSeconds}s deadline
                </p>

                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={!drafts[zone.zoneId] || update.isPending}
                    onClick={() => void save(zone)}
                    data-testid={`zone-save-${zone.zoneName.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    Save ladder
                  </Button>
                  {zone.override ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={update.isPending}
                      onClick={() => void clear(zone)}
                      data-testid={`zone-clear-${zone.zoneName.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      Clear override
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {errorMessage ? (
          <p className="mt-3 text-sm text-error" role="alert" data-testid="zone-ladder-error">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
