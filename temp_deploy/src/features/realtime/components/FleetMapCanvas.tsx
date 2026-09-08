'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { env } from '@/lib/env';
import { useThemeMode } from '@/lib/useThemeMode';
import { PositionAnimator } from '../lib/interpolate';
import { mapColors } from '../lib/mapColors';
import {
  HEADINGS_SOURCE,
  ROUTES_SOURCE,
  TRUCKS_SOURCE,
  TRUCK_DOT_LAYER,
  TRUCK_HALO_LAYER,
  ZONES_SOURCE,
  addFleetLayers,
  applyColors,
  headingsToGeoJson,
  routesToGeoJson,
  trucksToGeoJson,
  zonesToGeoJson,
} from '../lib/markerLayers';
import { vendorlessStyle } from '../lib/mapStyle';
import type { FleetPosition, FleetZone } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface FleetMapCanvasProps {
  positions: FleetPosition[];
  zones: FleetZone[];
  variant: 'full' | 'mini';
  selectedTruckId?: string | null;
  onSelectTruck?: (truckId: string | null) => void;
}

/** Bengaluru (§2 persona city) — where the camera starts before any data lands. */
const FALLBACK_CENTER: [number, number] = [77.5946, 12.9716];

export default function FleetMapCanvas({
  positions,
  zones,
  variant,
  selectedTruckId,
  onSelectTruck,
}: FleetMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const animatorRef = useRef(new PositionAnimator());
  const positionsRef = useRef(positions);
  const frameRef = useRef<number | null>(null);
  const hasFittedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const mode = useThemeMode();

  positionsRef.current = positions;

  // Create the map exactly once. Style/data/colour updates all happen through
  // the imperative API below — recreating it would restart the camera and drop
  // the operator's pan on every render.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const colors = mapColors(mode);
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: env.mapStyleUrl || vendorlessStyle(colors),
        center: FALLBACK_CENTER,
        zoom: variant === 'mini' ? 10 : 11,
        attributionControl: false,
        // No basemap by default means nothing to read at a tilt.
        pitchWithRotate: false,
        dragRotate: false,
      });
    } catch {
      // WebGL unavailable (headless without swiftshader, blocklisted driver, a
      // locked-down corporate build). The caller renders a list instead — the
      // console must degrade, not blank out.
      setFailed(true);
      return;
    }

    mapRef.current = map;
    map.on('error', () => {
      /* tile/style errors are non-fatal for a vendorless style */
    });

    if (variant === 'full') {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    }

    map.on('load', () => {
      addFleetLayers(map, mapColors(mode));
      setReady(true);
    });

    if (onSelectTruck) {
      map.on('click', TRUCK_DOT_LAYER, (event) => {
        const truckId = event.features?.[0]?.properties?.truckId;
        if (typeof truckId === 'string') onSelectTruck(truckId);
      });
      // Clicking empty map dismisses the panel — the standard escape hatch.
      map.on('click', (event) => {
        const hits = map.queryRenderedFeatures(event.point, {
          layers: [TRUCK_DOT_LAYER, TRUCK_HALO_LAYER].filter((l) => map.getLayer(l)),
        });
        if (hits.length === 0) onSelectTruck(null);
      });
      for (const [type, cursor] of [
        ['mouseenter', 'pointer'],
        ['mouseleave', ''],
      ] as const) {
        map.on(type, TRUCK_DOT_LAYER, () => {
          map.getCanvas().style.cursor = cursor;
        });
      }
    }

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Intentionally created once: `mode` and `variant` are read at construction
    // and then maintained imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme flips repaint in place — MapLibre cannot read CSS variables, so the
  // colours have to be pushed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyColors(map, mapColors(mode));
  }, [mode, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(ZONES_SOURCE);
    if (source && 'setData' in source) {
      (source as maplibregl.GeoJSONSource).setData(zonesToGeoJson(zones) as never);
    }
  }, [zones, ready]);

  // Retarget the tweens whenever a batch lands, and run a rAF loop only while
  // something is actually moving.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    animatorRef.current.update(positions, Date.now());

    if (!hasFittedRef.current) {
      const located = positions.filter((p) => p.lat !== null && p.lng !== null);
      if (located.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const p of located) bounds.extend([p.lng as number, p.lat as number]);
        map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
        // Fit once: re-fitting on every batch would fight the operator's pan.
        hasFittedRef.current = true;
      }
    }

    const draw = () => {
      const now = Date.now();
      const frames = animatorRef.current.frames(now);
      const trucks = map.getSource(TRUCKS_SOURCE);
      const headings = map.getSource(HEADINGS_SOURCE);
      if (trucks && 'setData' in trucks) {
        (trucks as maplibregl.GeoJSONSource).setData(
          trucksToGeoJson(positionsRef.current, now, frames) as never,
        );
      }
      if (headings && 'setData' in headings) {
        (headings as maplibregl.GeoJSONSource).setData(
          headingsToGeoJson(positionsRef.current, now, frames) as never,
        );
      }
      const routes = map.getSource(ROUTES_SOURCE);
      if (routes && 'setData' in routes) {
        // Redrawn with the tween so the leg's truck end tracks the marker
        // instead of snapping a second behind it.
        (routes as maplibregl.GeoJSONSource).setData(
          routesToGeoJson(positionsRef.current, frames) as never,
        );
      }

      frameRef.current = animatorRef.current.isAnimating(now) ? requestAnimationFrame(draw) : null;
    };

    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [positions, ready]);

  // Centre on the selected truck without changing zoom — the operator picked a
  // truck, not a new view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedTruckId) return;
    const target = positions.find((p) => p.truckId === selectedTruckId);
    if (target?.lat != null && target.lng != null) {
      map.easeTo({ center: [target.lng, target.lat], duration: 400 });
    }
  }, [selectedTruckId, positions, ready]);

  if (failed) {
    return (
      <div
        data-testid="fleet-map-unavailable"
        className="flex h-full items-center justify-center rounded-card bg-map-bg p-6 text-center text-sm text-text-secondary dark:bg-surface1"
      >
        This browser cannot render the map (WebGL unavailable). Truck positions are still listed
        alongside.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="fleet-map"
      className="h-full w-full overflow-hidden rounded-card bg-map-bg dark:bg-surface1"
    />
  );
}
