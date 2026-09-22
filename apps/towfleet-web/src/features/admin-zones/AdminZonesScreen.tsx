'use client';

import { useRef, useState } from 'react';
import type { GeoJsonPolygon } from '@towing/api-contracts';
import { Skeleton } from '@towing/web-ui';
import { useAdminZones } from './api/adminZones.queries';
import { ZoneEditorPanel } from './components/ZoneEditorPanel';
import { ZoneList } from './components/ZoneList';
import { ZoneMap } from './components/ZoneMap';
import { ZoneVersionsDrawer } from './components/ZoneVersionsDrawer';
import type { ZoneMapHandle } from './components/ZoneMapCanvas';

/**
 * `/admin/zones` — W13's §9.4.8 service-zone editor.
 *
 * ONE STATE MACHINE, THREE PANELS. The rail selects a zone, the map holds the
 * shape being edited, and the form (plus its preview) describes what saving it
 * would do. The draft lives HERE rather than inside the map because the form
 * has to be able to compare it against the saved shape — "is this a reshape?"
 * is the question that decides whether a version is written.
 *
 * The screen never guesses at the API: the resolution order, the area in km²
 * and the impact numbers all come from the server, which is the only party that
 * can answer them (PostGIS and the presence store respectively).
 */
export function AdminZonesScreen() {
  const zones = useAdminZones();
  const mapHandle = useRef<ZoneMapHandle | null>(null);

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<GeoJsonPolygon | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);

  const selectedZone = zones.data?.items.find((zone) => zone.id === selectedZoneId) ?? null;

  /** Discard whatever is on the map before the next zone's shape lands in it. */
  const resetDraft = () => {
    setDraft(null);
    mapHandle.current?.clearDraft();
  };

  const select = (zoneId: string) => {
    setCreating(false);
    setVersionsOpen(false);
    setSelectedZoneId(zoneId);
    resetDraft();
  };

  const startNew = () => {
    setSelectedZoneId(null);
    setVersionsOpen(false);
    setCreating(true);
    setDraft(null);
    mapHandle.current?.drawNew();
  };

  const afterSave = (zoneId: string) => {
    setCreating(false);
    setSelectedZoneId(zoneId);
    resetDraft();
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <ZoneList
          data={zones.data}
          loading={zones.isLoading}
          selectedZoneId={selectedZoneId}
          creating={creating}
          onSelect={select}
          onNew={startNew}
        />

        <div className="space-y-5">
          {zones.isError ? (
            <p className="text-sm text-error">Could not load the service areas.</p>
          ) : zones.isLoading ? (
            <Skeleton className="h-[26rem] w-full" />
          ) : (
            <>
              <div className="h-[26rem]">
                <ZoneMap
                  zones={zones.data?.items ?? []}
                  selectedZoneId={selectedZoneId}
                  onSelect={(zoneId) => {
                    if (zoneId) select(zoneId);
                  }}
                  onDraft={setDraft}
                  onReady={(handle) => {
                    mapHandle.current = handle;
                  }}
                />
              </div>

              <ZoneEditorPanel
                zone={selectedZone}
                creating={creating}
                draft={draft}
                onDrawRequested={() => mapHandle.current?.editSelected()}
                onSaved={afterSave}
                onOpenVersions={() => setVersionsOpen(true)}
              />
            </>
          )}
        </div>
      </div>

      {/* One line of honesty about the screen's own limits. */}
      <p className="text-xs text-text-tertiary">
        Deleting is not offered: a zone that ever priced a ride has to stay resolvable for the
        bookings that cite it — pause it instead. Reshaping re-homes or takes offline whoever is
        standing in the difference, immediately.
      </p>

      <ZoneVersionsDrawer
        zone={selectedZone}
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
      />
    </div>
  );
}
