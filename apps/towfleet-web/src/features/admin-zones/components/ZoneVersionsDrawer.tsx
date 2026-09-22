'use client';

import { useState } from 'react';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  RelativeTime,
  Skeleton,
} from '@towing/web-ui';
import type { AdminZone } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { useAdminZoneVersions } from '../api/adminZones.queries';
import { useRestoreZoneVersion } from '../api/adminZones.mutations';

/**
 * §9.4.8's "versioned", as a drawer: every shape this zone has ever had, with
 * the reason it stopped having it.
 *
 * A RESTORE WRITES A NEW VERSION — it does not rewind. That is the whole point:
 * "put it back the way it was last Tuesday" is itself a change somebody made
 * for a reason, and the history that hides it is the history nobody trusts. The
 * backend does exactly this (`restore` applies an old snapshot as the next
 * version), and the button says so before it is pressed.
 */
export function ZoneVersionsDrawer({
  zone,
  open,
  onClose,
}: {
  zone: AdminZone | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const versions = useAdminZoneVersions(open ? (zone?.id ?? null) : null);
  const restore = useRestoreZoneVersion();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const apply = async (versionId: string, version: number) => {
    if (!zone) return;
    setErrorMessage(null);
    try {
      const restored = await restore.mutateAsync({ zoneId: zone.id, versionId });
      setConfirming(null);
      toast(`Restored version ${version} as version ${restored.version}`, 'success');
      onClose();
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} labelledBy="zone-versions-title">
      <DrawerHeader>
        <DrawerTitle id="zone-versions-title">
          {zone ? `${zone.name} — shape history` : 'Shape history'}
        </DrawerTitle>
      </DrawerHeader>
      <DrawerBody>
        {versions.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : versions.isError ? (
          <p className="text-sm text-error">Could not load this zone&apos;s history.</p>
        ) : (versions.data ?? []).length === 0 ? (
          <p className="text-sm text-text-secondary">No recorded shapes for this zone.</p>
        ) : (
          <ol className="space-y-3">
            {(versions.data ?? []).map((entry) => (
              <li
                key={entry.id}
                className="rounded-card border border-border px-3 py-2"
                data-testid={`version-row-${entry.version}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Version {entry.version}</span>
                  <span className="text-xs text-text-tertiary">
                    <RelativeTime at={entry.createdAt} />
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  {entry.reason ?? 'No reason recorded.'}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">
                  {entry.isActive ? 'Live' : 'Paused'} · {entry.surgeBand}
                  {entry.isHighway ? ' · highway' : ''}
                  {entry.changedBy ? ' · by an operator' : ' · seeded'}
                </p>

                {entry.version === zone?.version ? (
                  <p className="mt-1 text-xs text-text-tertiary" data-testid="version-current">
                    This is the shape in force.
                  </p>
                ) : confirming === entry.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-text-secondary">
                      Restore this shape as a new version?
                    </span>
                    <Button
                      size="sm"
                      disabled={restore.isPending}
                      onClick={() => void apply(entry.id, entry.version)}
                      data-testid={`version-confirm-${entry.version}`}
                    >
                      Yes, restore
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => setConfirming(entry.id)}
                    data-testid={`version-restore-${entry.version}`}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}

        {errorMessage ? (
          <p className="mt-3 text-sm text-error" data-testid="version-error">
            {errorMessage}
          </p>
        ) : null}
      </DrawerBody>
      <DrawerFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
