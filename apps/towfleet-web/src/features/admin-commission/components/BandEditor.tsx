'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@towing/web-ui';
import type { AdminCommissionConfig, Band } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useUpdateCommissionBands } from '../api/adminCommission.mutations';

/**
 * §9.4.9's band editor with §3.3's guardrail.
 *
 * THE GUARDRAIL IS ENFORCED IN THREE PLACES AND THIS IS ONLY THE FIRST: the
 * form disables Save and says why, the service refuses with a 422 that is also
 * AUDITED, and the database holds the absolute outer bound. A screen that let
 * the operator discover the rule by round trip would still be safe — it would
 * just be a worse screen.
 *
 * SINCE W11 THE WINDOW IS LIVE (decision G2): the numbers come from
 * `commission_guardrail`, so a super admin who moved it to 6–12 really can save
 * 11 % here. Nothing about this form is hard-coded to 5–10.
 *
 * SAVE SENDS A DIFF: only bands whose percentage changed.
 */
export function BandEditor({
  config,
  canEdit,
  draft,
  onDraftChange,
}: {
  config: AdminCommissionConfig;
  canEdit: boolean;
  /** Shared with the impact preview — the operator previews what they typed. */
  draft: Record<Band, string>;
  onDraftChange: (next: Record<Band, string>) => void;
}) {
  const toast = useToast();
  const update = useUpdateCommissionBands();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Seed once per loaded config — editing must not fight a refetch.
  useEffect(() => {
    onDraftChange(
      Object.fromEntries(config.bands.map((band) => [band.band, String(band.pct)])) as Record<
        Band,
        string
      >,
    );
    // Deliberately keyed on the server config alone: re-seeding on every
    // keystroke would erase what the operator is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const pct = (band: Band): number => Number(draft[band]);
  const outOfWindow = config.bands.filter((band) => {
    const value = pct(band.band);
    return Number.isFinite(value) && (value < config.floorPct || value > config.capPct);
  });

  const changed = config.bands
    .filter((band) => Number.isFinite(pct(band.band)) && pct(band.band) !== band.pct)
    .map((band) => ({ band: band.band, pct: pct(band.band) }));

  const canSave = canEdit && !update.isPending && changed.length > 0 && outOfWindow.length === 0;

  const save = async () => {
    if (!canSave) return;
    setErrorMessage(null);
    try {
      await update.mutateAsync({ bands: changed, reason: 'Band edit from the console' });
      toast('Commission bands saved', 'success');
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commission bands</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-text-secondary" data-testid="band-window">
          §3.3 percentages. The window is{' '}
          <strong>
            {config.floorPct}–{config.capPct} %
          </strong>
          {config.guardrailUpdatedAt
            ? ` (last moved ${new Date(config.guardrailUpdatedAt).toLocaleDateString('en-IN')})`
            : ''}
          ; an attempt outside it is refused AND written to the audit log.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {config.bands.map((band) => (
            <Field
              key={band.band}
              label={`Band ${band.band} (percent)`}
              htmlFor={`band-${band.band}`}
            >
              <Input
                id={`band-${band.band}`}
                inputMode="decimal"
                value={draft[band.band] ?? ''}
                onChange={(event) => onDraftChange({ ...draft, [band.band]: event.target.value })}
                data-testid={`band-${band.band}`}
              />
              <span className="mt-1 block text-xs text-text-tertiary">
                Live since {new Date(band.updatedAt).toLocaleDateString('en-IN')}
              </span>
            </Field>
          ))}
        </div>

        {outOfWindow.length > 0 ? (
          <p className="mt-3 text-sm text-error" data-testid="band-guardrail-error">
            {outOfWindow.map((band) => `Band ${band.band}`).join(', ')} sit outside the current{' '}
            {config.floorPct}–{config.capPct} % window.
          </p>
        ) : null}
        {errorMessage ? (
          <p className="mt-3 text-sm text-error" role="alert" data-testid="band-error">
            {errorMessage}
          </p>
        ) : null}

        {canEdit ? (
          <div className="mt-4">
            <Button onClick={() => void save()} disabled={!canSave} data-testid="band-save">
              {update.isPending ? 'Saving…' : 'Save bands'}
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-text-secondary" data-testid="band-readonly">
            Read-only: saving a rate needs Finance or a super admin. You can still type above to
            preview an impact, and propose the change below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
