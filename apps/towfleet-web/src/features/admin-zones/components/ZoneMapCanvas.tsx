'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  ValidateNotSelfIntersecting,
  type HexColor,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { AdminZone, GeoJsonPolygon } from '@towing/api-contracts';
import { Button } from '@towing/web-ui';
import { env } from '@/lib/env';
import { useThemeMode } from '@/lib/useThemeMode';
import { mapColors } from '@/features/realtime/lib/mapColors';
import { vendorlessStyle } from '@/features/realtime/lib/mapStyle';
import {
  ZONES_FILL_LAYER,
  addZoneLayers,
  applyZoneColors,
  setZoneData,
} from '../lib/zoneMapLayers';
import 'maplibre-gl/dist/maplibre-gl.css';

/** Bengaluru, §2's persona city — where the camera starts before data lands. */
const FALLBACK_CENTER: [number, number] = [77.5946, 12.9716];

export type ZoneDrawMode = 'idle' | 'polygon' | 'select';

/**
 * The map's imperative surface. The toolbar lives HERE (it is inherently
 * map-coupled) and the screen calls into it only for the two entry points a
 * panel button needs: start a new shape, or load the selected zone's.
 */
export interface ZoneMapHandle {
  drawNew: () => void;
  editSelected: () => void;
  clearDraft: () => void;
  undo: () => void;
}

export interface ZoneMapCanvasProps {
  zones: AdminZone[];
  selectedZoneId: string | null;
  onSelect: (zoneId: string | null) => void;
  /** Fires with the shape currently on the map, `null` when there is none. */
  onDraft: (area: GeoJsonPolygon | null) => void;
  onReady: (handle: ZoneMapHandle | null) => void;
}

/**
 * The zone editor's canvas (W13, §9.4.8): draw a service area, then move the
 * corners until the preview says what you want it to say.
 *
 * WHY TERRA DRAW AND NOT A HAND-ROLLED CLICK HANDLER: a polygon editor is
 * vertex insertion, midpoint dragging, undo, closing-point semantics and
 * self-intersection validation — and the last of those is the one the SERVER
 * refuses on (`ST_IsValid`). `ValidateNotSelfIntersecting` is the same rule
 * enforced while the ring is being closed, so the 422 is what happens when a
 * script or a stale client bypasses the UI, not what an operator discovers.
 *
 * WebGL-unavailable degrades to a labelled panel — the list, the form and the
 * preview stay usable, which is what an operator on a locked-down laptop needs.
 */
export default function ZoneMapCanvas({
  zones,
  selectedZoneId,
  onSelect,
  onDraft,
  onReady,
}: ZoneMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<ZoneDrawMode>('idle');

  // Callbacks live in refs: Terra Draw's listeners are registered once and
  // would otherwise capture the first render's props for the life of the map.
  const onDraftRef = useRef(onDraft);
  const onSelectRef = useRef(onSelect);
  onDraftRef.current = onDraft;
  onSelectRef.current = onSelect;

  const mode_ = useThemeMode();
  const colors = useMemo(() => mapColors(mode_), [mode_]);
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId) ?? null;
  const selectedZoneRef = useRef<AdminZone | null>(selectedZone);
  selectedZoneRef.current = selectedZone;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: env.mapStyleUrl || vendorlessStyle(colors),
        center: FALLBACK_CENTER,
        zoom: 9,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
      });
    } catch {
      setFailed(true);
      return;
    }

    mapRef.current = map;
    map.on('error', () => {
      /* tile/style errors are non-fatal for a vendorless style */
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      addZoneLayers(map, colors);
      setZoneData(map, zones, selectedZoneId);

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            // The server's rule, enforced at the corner: a ring that crosses
            // itself cannot be closed. The 422 is the backstop, not the UX.
            validation: (feature) => ValidateNotSelfIntersecting(feature),
            // `HexColor` is Terra Draw's `#${string}` brand; the map tokens are
            // hex by construction, so this cast is the whole conversion.
            styles: {
              fillColor: colors.onJob as HexColor,
              fillOpacity: 0.25,
              outlineColor: colors.onJob as HexColor,
              outlineWidth: 2,
              closingPointColor: colors.onJob as HexColor,
              closingPointWidth: 4,
              coordinatePointColor: colors.onJob as HexColor,
              coordinatePointWidth: 4,
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: { midpoints: true, draggable: true, deletable: true },
                },
              },
            },
          }),
        ],
      });

      draw.on('change', () => onDraftRef.current(polygonFromSnapshot(draw)));
      draw.start();
      drawRef.current = draw;
      setReady(true);
    });

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Deliberately mount-only: the data and the theme flow through the effects
    // below, and rebuilding the map on a prop change would drop the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setZoneData(map, zones, selectedZoneId);
  }, [ready, zones, selectedZoneId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyZoneColors(map, colors);
  }, [ready, colors]);

  /** The camera follows the selection — the operator never hunts for the box. */
  useEffect(() => {
    const map = mapRef.current;
    const zone = selectedZone;
    if (!ready || !map || !zone || mode !== 'idle') return;

    const ring = zone.area.coordinates[0]!;
    const lngs = ring.map(([lng]) => lng!);
    const lats = ring.map(([, lat]) => lat!);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, duration: 400 },
    );
  }, [ready, selectedZone, mode]);

  const setDrawMode = (next: ZoneDrawMode) => {
    const draw = drawRef.current;
    if (!draw) return;
    setMode(next);
    draw.setMode(next === 'idle' ? 'static' : next);
  };

  const handle: ZoneMapHandle = {
    drawNew: () => {
      const draw = drawRef.current;
      if (!draw) return;
      draw.clear();
      onDraftRef.current(null);
      setDrawMode('polygon');
    },
    editSelected: () => {
      const draw = drawRef.current;
      const zone = selectedZoneRef.current;
      if (!draw || !zone) return;
      draw.clear();
      draw.addFeatures([
        {
          type: 'Feature',
          // `mode` is how the store knows which mode owns the feature; without
          // it the select mode has nothing to select.
          properties: { mode: 'polygon' },
          geometry: zone.area,
        },
      ]);
      onDraftRef.current(zone.area);
      setDrawMode('select');
    },
    clearDraft: () => {
      const draw = drawRef.current;
      if (!draw) return;
      draw.clear();
      onDraftRef.current(null);
      setDrawMode('idle');
    },
    undo: () => drawRef.current?.undo(),
  };

  useEffect(() => {
    onReady(handle);
    return () => onReady(null);
    // The handle is rebuilt every render on purpose: it closes over refs, so a
    // new object costs nothing and a stale one would call into a dead map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (failed) {
    return (
      <div
        className="flex h-full min-h-64 items-center justify-center rounded-md border border-border p-6 text-center text-sm text-text-secondary"
        data-testid="zone-map-fallback"
      >
        This browser cannot render the map (WebGL is unavailable), so shapes cannot be drawn here.
        The list, the zone form and the impact preview all still work.
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-64 overflow-hidden rounded-md border border-border">
      <div ref={containerRef} className="h-full w-full" data-testid="zone-map" />

      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'polygon' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'polygon'}
          onClick={handle.drawNew}
          data-testid="zone-draw"
        >
          Draw polygon
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'select' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'select'}
          disabled={!selectedZone}
          onClick={handle.editSelected}
          data-testid="zone-edit-shape"
        >
          Move corners
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={mode === 'idle'}
          onClick={handle.undo}
          data-testid="zone-undo"
        >
          Undo point
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={mode === 'idle'}
          onClick={handle.clearDraft}
          data-testid="zone-clear"
        >
          Clear
        </Button>
      </div>

      <p className="absolute bottom-3 left-3 rounded bg-surface/90 px-2 py-1 text-xs text-text-secondary">
        {mode === 'polygon'
          ? 'Click to add a corner, and click the first corner again to close the shape.'
          : mode === 'select'
            ? 'Drag a corner, or a midpoint to add one. Right-click removes a corner.'
            : 'Select a zone on the left, or draw a new one.'}
      </p>

      <div className="absolute top-3 right-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onSelectRef.current(null)}
          data-testid="zone-deselect"
        >
          Deselect
        </Button>
      </div>
    </div>
  );
}

/**
 * The one polygon the editor ever holds, as the API's GeoJSON: `[lng, lat]`
 * pairs, closed ring, six decimal places (~11 cm — finer than any handset fix).
 *
 * A ring still being drawn is rejected rather than half-saved: Terra Draw's
 * store holds the shape from the first vertex onwards (and repeats the closing
 * point), so "has ≥ 4 positions" is not enough. A ring with no width or no
 * height is also rejected — the server's `ST_IsValid` would accept a sliver, and
 * the resolver would then never match anything inside it.
 */
function polygonFromSnapshot(draw: TerraDraw): GeoJsonPolygon | null {
  const feature = draw.getSnapshot().find((entry) => entry.geometry.type === 'Polygon');
  if (!feature) return null;

  const ring = (feature.geometry as { coordinates: number[][][] }).coordinates[0];
  if (!ring || ring.length < 3) return null;

  const positions = ring.map(([lng, lat]) => [
    Number((lng ?? 0).toFixed(6)),
    Number((lat ?? 0).toFixed(6)),
  ]) as Array<[number, number]>;

  // GeoJSON requires the ring to close; Terra Draw leaves it open while the
  // shape is still being edited, and an open ring is what the server's parser
  // rejects — so this is the one place the two vocabularies meet.
  const first = positions[0]!;
  const last = positions[positions.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) positions.push([first[0], first[1]]);

  if (positions.length < 4) return null;

  const lngs = positions.map(([lng]) => lng);
  const lats = positions.map(([, lat]) => lat);
  if (Math.max(...lngs) === Math.min(...lngs) || Math.max(...lats) === Math.min(...lats)) {
    return null;
  }

  return { type: 'Polygon', coordinates: [positions] };
}
