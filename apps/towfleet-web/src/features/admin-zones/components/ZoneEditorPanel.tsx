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
  Switch,
  Textarea,
} from '@towing/web-ui';
import {
  surgeBandSchema,
  type AdminZone,
  type AdminZonePreview,
  type GeoJsonPolygon,
} from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useCreateZone,
  usePreviewZone,
  useSetZoneActive,
  useUpdateZone,
} from '../api/adminZones.mutations';

/**
 * The zone form, the impact preview and the pause switch — one column, because
 * they answer one question between them: what does this shape do?
 *
 * THE REASON IS REQUIRED FOR EVERY WRITE. Zones decide where a driver is
 * considered to be, and `service_zone_versions.reason` is what the drawer shows
 * next to a shape six months later; a version history of anonymous edits is a
 * version history nobody can act on.
 *
 * The code slug is the ONE thing checked live: it is what the audit trail, the
 * dispatch ladder and the seed all cite a zone by, and renaming it breaks every
 * one of those references.
 */

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ZoneEditorPanelProps {
  /** `null` while a new zone is being drawn. */
  zone: AdminZone | null;
  creating: boolean;
  /** The shape currently on the map, if any. */
  draft: GeoJsonPolygon | null;
  onDrawRequested: () => void;
  onSaved: (zoneId: string) => void;
  onOpenVersions: () => void;
}

export function ZoneEditorPanel({
  zone,
  creating,
  draft,
  onDrawRequested,
  onSaved,
  onOpenVersions,
}: ZoneEditorPanelProps) {
  const toast = useToast();
  const create = useCreateZone();
  const update = useUpdateZone();
  const setActive = useSetZoneActive();
  const preview = usePreviewZone();

  const [form, setForm] = useState({
    name: '',
    code: '',
    notes: '',
    surgeBand: 'standard',
    isHighway: false,
    reason: '',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [impact, setImpact] = useState<AdminZonePreview | null>(null);
  const [confirmingPause, setConfirmingPause] = useState(false);

  useEffect(() => {
    setImpact(null);
    setErrorMessage(null);
    setConfirmingPause(false);
    setForm({
      name: zone?.name ?? '',
      code: zone?.code ?? '',
      notes: zone?.notes ?? '',
      surgeBand: zone?.surgeBand ?? 'standard',
      isHighway: zone?.isHighway ?? false,
      reason: '',
    });
  }, [zone, creating]);

  /**
   * Drawing with nothing selected IS creating a zone — the operator pressed
   * Draw polygon on a screen whose only other mode is "edit the selected one".
   * Derived rather than written into state so that a name typed before the
   * shape was closed is not wiped by the reset effect below.
   */
  const effectiveCreating = creating || !zone;

  const shapeChanged =
    !zone || !draft ? false : JSON.stringify(draft) !== JSON.stringify(zone.area);
  const codeValid = CODE_PATTERN.test(form.code) && form.code.length >= 3 && form.code.length <= 40;
  const nameValid = form.name.trim().length >= 3;
  const reasonValid = form.reason.trim().length >= 3;

  const detailsChanged =
    !!zone &&
    (form.name !== zone.name ||
      form.code !== zone.code ||
      form.notes !== (zone.notes ?? '') ||
      form.surgeBand !== zone.surgeBand ||
      form.isHighway !== zone.isHighway);

  const nothingToSave = effectiveCreating ? false : !detailsChanged && !shapeChanged;
  const canSave =
    !create.isPending &&
    !update.isPending &&
    nameValid &&
    codeValid &&
    reasonValid &&
    !nothingToSave &&
    (effectiveCreating ? !!draft : true);

  const buildPreview = async () => {
    const area = draft ?? zone?.area;
    if (!area) return;
    setImpact(
      await preview.mutateAsync({
        area,
        excludeZoneId: zone?.id,
        existingZoneId: zone?.id,
        isActive: true,
      }),
    );
  };

  const save = async () => {
    if (!canSave) return;
    setErrorMessage(null);

    try {
      if (effectiveCreating || !zone) {
        const created = await create.mutateAsync({
          name: form.name.trim(),
          code: form.code.trim(),
          notes: form.notes.trim() ? form.notes.trim() : null,
          area: draft!,
          surgeBand: form.surgeBand as AdminZone['surgeBand'],
          isHighway: form.isHighway,
          reason: form.reason.trim(),
        });
        toast(`${created.name} is live — the next estimate inside it prices here`, 'success');
        onSaved(created.id);
        return;
      }

      const saved = await update.mutateAsync({
        zoneId: zone!.id,
        body: {
          ...(form.name !== zone!.name ? { name: form.name.trim() } : {}),
          ...(form.code !== zone!.code ? { code: form.code.trim() } : {}),
          ...(form.notes !== (zone!.notes ?? '')
            ? { notes: form.notes.trim() ? form.notes.trim() : null }
            : {}),
          ...(form.surgeBand !== zone!.surgeBand
            ? { surgeBand: form.surgeBand as AdminZone['surgeBand'] }
            : {}),
          ...(form.isHighway !== zone!.isHighway ? { isHighway: form.isHighway } : {}),
          ...(shapeChanged ? { area: draft! } : {}),
          reason: form.reason.trim(),
        },
      });
      toast(
        shapeChanged
          ? `${saved.name} reshaped — version ${saved.version}, reconcile ran`
          : `${saved.name} saved`,
        'success',
      );
      onSaved(saved.id);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  const toggleActive = async () => {
    if (!zone) return;
    setErrorMessage(null);
    try {
      const saved = await setActive.mutateAsync({
        zoneId: zone.id,
        active: !zone.isActive,
        reason: form.reason.trim() || undefined,
      });
      toast(
        saved.isActive
          ? `${saved.name} reopened — drivers can go online here again`
          : `${saved.name} paused — drivers inside were re-homed or taken offline`,
        'success',
      );
      setConfirmingPause(false);
      onSaved(saved.id);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{effectiveCreating ? 'New service area' : 'Zone'}</CardTitle>
        {zone ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpenVersions}
            data-testid="zone-versions"
          >
            Shape history ({zone.version})
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="zone-name">
            <Input
              id="zone-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              data-testid="zone-name"
            />
          </Field>
          <Field label="Code — lower-case words, hyphens" htmlFor="zone-code">
            <Input
              id="zone-code"
              value={form.code}
              onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
              data-testid="zone-code"
            />
          </Field>
        </div>
        {form.code && !codeValid ? (
          <p className="text-sm text-error" data-testid="zone-code-error">
            The code is cited by the audit trail and the dispatch ladder — use lower-case words
            separated by hyphens (at least 3 characters).
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Surge band" htmlFor="zone-surge">
            <Select
              id="zone-surge"
              value={form.surgeBand}
              onChange={(event) =>
                setForm((current) => ({ ...current, surgeBand: event.target.value }))
              }
              data-testid="zone-surge"
            >
              {surgeBandSchema.options.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-card border border-border px-3 py-2">
            <span id="zone-highway-label" className="text-sm font-semibold">
              Highway corridor
            </span>
            <Switch
              checked={form.isHighway}
              labelledBy="zone-highway-label"
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, isHighway: checked }))
              }
            />
          </div>
        </div>

        <Field label="Notes" htmlFor="zone-notes">
          <Textarea
            id="zone-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            data-testid="zone-notes"
          />
        </Field>

        <p
          className={shapeChanged ? 'text-sm text-brand' : 'text-sm text-text-secondary'}
          data-testid="zone-shape-hint"
        >
          {effectiveCreating
            ? draft
              ? 'Shape captured — this is what the resolver will use.'
              : 'No shape yet — press Draw polygon, then click the map to place the corners.'
            : shapeChanged
              ? 'Unsaved shape change. Saving writes a new version and re-homes or evicts anyone standing in the difference.'
              : 'The shape on the map matches the saved one.'}
        </p>
        {!effectiveCreating && !shapeChanged ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onDrawRequested}
            data-testid="zone-edit-shape-panel"
          >
            Move corners on the map
          </Button>
        ) : null}

        <Field label="Reason (goes in the shape history)" htmlFor="zone-reason">
          <Input
            id="zone-reason"
            value={form.reason}
            placeholder="Why this change?"
            onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            data-testid="zone-reason"
          />
        </Field>
        {form.reason.length > 0 && !reasonValid ? (
          <p className="text-sm text-error" data-testid="zone-reason-error">
            Give the change a reason of at least 3 characters — the drawer shows it beside the
            shape.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!canSave} onClick={() => void save()} data-testid="zone-save">
            {effectiveCreating ? 'Create zone' : 'Save zone'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={(!draft && !zone) || preview.isPending}
            onClick={async () => {
              setErrorMessage(null);
              try {
                await buildPreview();
              } catch (error) {
                setErrorMessage((error as Error).message);
              }
            }}
            data-testid="zone-preview"
          >
            Preview impact
          </Button>
        </div>

        {zone ? (
          <div
            className="rounded-card border border-border px-3 py-2"
            data-testid={`zone-pause-${zone.code}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <span id="zone-active-label" className="text-sm font-semibold">
                  {zone.isActive ? 'Live' : 'Paused'}
                </span>
                <p className="text-xs text-text-secondary" data-testid="zone-active-state">
                  {confirmingPause
                    ? zone.isActive
                      ? 'New bookings will be refused here, live offers revoked, and drivers inside re-homed or taken offline.'
                      : 'Drivers who go online inside can be dispatched here again.'
                    : zone.isActive
                      ? 'Priced and dispatchable.'
                      : 'Dark: skipped by the resolver entirely.'}
                </p>
              </div>
              {confirmingPause ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={zone.isActive ? 'destructive' : 'primary'}
                    disabled={setActive.isPending}
                    onClick={() => void toggleActive()}
                    data-testid="zone-confirm-pause"
                  >
                    Yes, {zone.isActive ? 'pause' : 'reopen'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingPause(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant={zone.isActive ? 'outline' : 'secondary'}
                  onClick={() => setConfirmingPause(true)}
                  data-testid={`zone-toggle-${zone.code}`}
                >
                  {zone.isActive ? 'Pause zone' : 'Reopen zone'}
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {impact ? (
          <div
            className="rounded-card border border-border px-3 py-2 text-xs"
            data-testid="zone-impact"
          >
            <p className="font-semibold">What this shape covers</p>
            <p className="mt-1 text-text-secondary">
              {impact.areaKm2.toFixed(1)} km² · {impact.onlineDriversInside} driver(s) inside
              {' · '}
              {impact.liveBookingsInside} live booking(s)
              {impact.driversToEvict > 0
                ? ` · ${impact.driversToEvict} would be taken offline (outside every active zone)`
                : ''}
            </p>
            <p className="mt-1 text-text-secondary" data-testid="zone-impact-overlaps">
              {impact.overlaps.length === 0
                ? 'Overlaps nothing.'
                : `Overlaps: ${impact.overlaps.map((entry) => entry.zoneName).join(', ')}`}
            </p>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="text-sm text-error" data-testid="zone-error">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
