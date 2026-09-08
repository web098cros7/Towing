'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import type { CoarsePosition } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { mapColors } from '@/features/realtime/lib/mapColors';
import { vendorlessStyle } from '@/features/realtime/lib/mapStyle';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * §11.7's map: one coarse truck, one pickup area, one route line.
 *
 * NO INTERACTION AT ALL — no drag, no zoom, no click handlers. This is a page
 * anyone forwarded a link can open, and every interactive surface on it is a
 * surface that has to be reasoned about. There is also nothing to explore: the
 * position is snapped to a ~100 m grid, so zooming in would show precision the
 * data does not have and invite exactly the wrong conclusion about it.
 *
 * THE VENDORLESS STYLE IS THE DEFAULT, as everywhere else in this app: a
 * token-coloured background with no tile source, no API key and no external
 * request. `NEXT_PUBLIC_MAP_STYLE_URL` swaps in a real basemap and the layers
 * below compose with either — the same seam Phase 5 built.
 *
 * WHAT IT DOES NOT DRAW, and each absence is the point: no service zones (the
 * fleet's coverage geography is not a link recipient's business), no other
 * trucks, no drop marker, and no labels carrying a name.
 */

export interface TrackMapCanvasProps {
  position: CoarsePosition | null;
  pickupArea: { lat: number; lng: number } | null;
  /** Decoded driver→pickup polyline. Empty when Directions was unavailable. */
  route: { lat: number; lng: number }[];
  /** §11.6 — dim the marker once the fix is older than the shared threshold. */
  ghost: boolean;
}

const FALLBACK_CENTER: [number, number] = [77.5946, 12.9716];

/**
 * Locally typed rather than reaching for the ambient `GeoJSON` namespace, which
 * is what `markerLayers.ts` already does. `@types/geojson` is a transitive
 * dependency of maplibre-gl rather than a declared one here, so the global
 * namespace is present today and would vanish on a hoisting change — a compile
 * error nobody could explain from this file.
 */
type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { kind: 'pickup' | 'driver'; ghost: boolean };
};

export default function TrackMapCanvas({ position, pickupArea, route, ghost }: TrackMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const colors = mapColors('light');
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: env.mapStyleUrl || vendorlessStyle(colors),
        center: FALLBACK_CENTER,
        zoom: 12,
        attributionControl: false,
        // Everything off. See the header.
        interactive: false,
      });
    } catch {
      // WebGL unavailable. The page still shows the driver, plate and ETA — the
      // map is context, not the content.
      setFailed(true);
      return;
    }

    mapRef.current = map;
    map.on('error', () => {
      /* tile/style errors are non-fatal for a vendorless style */
    });

    map.on('load', () => {
      map.addSource('track-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('track-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'track-route-line',
        type: 'line',
        source: 'track-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': colors.onJob, 'line-width': 4, 'line-opacity': 0.7 },
      });

      // The pickup AREA is drawn as a circle rather than a pin, because that is
      // what it is: a ~100 m cell, not an address. A pin would claim a doorstep.
      map.addLayer({
        id: 'track-pickup-area',
        type: 'circle',
        source: 'track-points',
        filter: ['==', ['get', 'kind'], 'pickup'],
        paint: {
          'circle-radius': 22,
          'circle-color': colors.idle,
          'circle-opacity': 0.18,
          'circle-stroke-width': 1,
          'circle-stroke-color': colors.idle,
        },
      });

      map.addLayer({
        id: 'track-driver',
        type: 'circle',
        source: 'track-points',
        filter: ['==', ['get', 'kind'], 'driver'],
        paint: {
          'circle-radius': 8,
          'circle-color': colors.onJob,
          'circle-stroke-width': 3,
          'circle-stroke-color': colors.markerStroke,
          // §11.6's ghost, driven by the prop rather than by an age computed
          // here — the threshold lives in the contract and is applied by the
          // page, so this layer only renders the decision.
          'circle-opacity': ['case', ['get', 'ghost'], 0.4, 1],
          'circle-stroke-opacity': ['case', ['get', 'ghost'], 0.4, 1],
        },
      });

      setReady(true);
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const points = map.getSource('track-points') as maplibregl.GeoJSONSource | undefined;
    const line = map.getSource('track-route') as maplibregl.GeoJSONSource | undefined;
    if (!points || !line) return;

    const features: PointFeature[] = [];
    if (pickupArea) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pickupArea.lng, pickupArea.lat] },
        properties: { kind: 'pickup', ghost: false },
      });
    }
    if (position) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [position.lng, position.lat] },
        properties: { kind: 'driver', ghost },
      });
    }

    points.setData({ type: 'FeatureCollection', features });
    line.setData({
      type: 'FeatureCollection',
      features:
        route.length >= 2
          ? [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: route.map((point) => [point.lng, point.lat]),
                },
                properties: {},
              },
            ]
          : [],
    });

    /**
     * FIT ONCE, then leave the camera alone.
     *
     * The position updates every ten seconds and moves by a cell or two; re-fitting
     * on each poll would nudge the whole map under a viewer's eyes for no
     * information gain. The one-shot behaviour is the same call `MapPreview`
     * makes by default on mobile, and for the same reason.
     */
    if (fitted.current) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const feature of features) {
      bounds.extend(feature.geometry.coordinates);
    }
    for (const point of route) bounds.extend([point.lng, point.lat]);

    if (!bounds.isEmpty()) {
      fitted.current = true;
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    }
  }, [ghost, pickupArea, position, ready, route]);

  if (failed) {
    return (
      <div className="flex h-64 items-center justify-center rounded-card border border-border bg-muted text-sm text-muted-foreground">
        Map unavailable on this device
      </div>
    );
  }

  return <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-card" />;
}
