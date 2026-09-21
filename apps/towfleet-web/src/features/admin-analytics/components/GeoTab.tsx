'use client';

import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import type { AnalyticsGeoResponse } from '@towing/api-contracts';
import {
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@towing/web-ui';
import { env } from '@/lib/env';
import { useThemeMode } from '@/lib/useThemeMode';
import { mapColors } from '@/features/realtime/lib/mapColors';
import { vendorlessStyle } from '@/features/realtime/lib/mapStyle';
import 'maplibre-gl/dist/maplibre-gl.css';

const SOURCE_ID = 'analytics-demand';
const HEAT_LAYER = 'analytics-demand-heat';
const CENTER: [number, number] = [77.6, 13.0];

type Metric = 'bookings' | 'noDrivers';

/**
 * §22.2's geographic tab: demand and wave-depth heat, plus the per-zone table.
 *
 * The heat is a MapLibre `heatmap` layer over the SAME vendorless style the
 * live map uses (no tile vendor, no key, hermetic e2e) — one point per
 * ~0.01° rollup cell, weighted by the chosen metric. `no_drivers` is the
 * operationally interesting mode: it is where the searches went wide and
 * nobody came, which is a supply gap drawn on a map instead of described in a
 * spreadsheet.
 */
export function GeoTab({ data }: { data: AnalyticsGeoResponse | undefined }) {
  const mode = useThemeMode();
  const [metric, setMetric] = useState<Metric>('bookings');
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const containerRef = useState<HTMLDivElement | null>(null);

  const [container, setContainer] = containerRef;

  useEffect(() => {
    if (!container) return;

    let instance: MapLibreMap;
    try {
      instance = new maplibregl.Map({
        container,
        style: env.mapStyleUrl || vendorlessStyle(mapColors(mode)),
        center: CENTER,
        zoom: 11,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
      });
    } catch {
      // WebGL unavailable (headless without swiftshader, blocklisted driver).
      setFailed(true);
      return;
    }

    instance.on('error', () => {
      /* non-fatal for a vendorless style */
    });

    instance.on('load', () => {
      instance.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      instance.addLayer({
        id: HEAT_LAYER,
        type: 'heatmap',
        source: SOURCE_ID,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 10, 1],
          'heatmap-radius': 32,
          'heatmap-opacity': 0.75,
        },
      });
      setReady(true);
    });

    setMap(instance);
    return () => {
      instance.remove();
      setMap(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, mode]);

  useEffect(() => {
    if (!map || !ready || !data) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;

    const features = data.grid.map((cell) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [cell.cellLng, cell.cellLat] },
      properties: { weight: metric === 'bookings' ? cell.bookings : cell.noDrivers },
    }));

    source.setData({
      type: 'FeatureCollection',
      features,
    } as unknown as Parameters<GeoJSONSource['setData']>[0]);
  }, [map, ready, data, metric]);

  if (!data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const zoneRows = data.zones.slice(0, 60);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-text-secondary" htmlFor="geo-metric">
          Heat by
        </label>
        <Select
          id="geo-metric"
          data-testid="geo-metric"
          className="w-48"
          value={metric}
          onChange={(event) => setMetric(event.target.value as Metric)}
        >
          <option value="bookings">Bookings</option>
          <option value="noDrivers">No drivers found</option>
        </Select>
        <span className="text-xs text-text-secondary">
          ~1.1 km cells; darker = more of the chosen count.
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        {failed ? (
          <div className="flex h-96 items-center justify-center text-sm text-text-secondary">
            The map could not start (WebGL unavailable) — the zone table below is unaffected.
          </div>
        ) : (
          <div ref={setContainer} className="h-96 w-full" data-testid="analytics-heatmap" />
        )}
      </div>

      <div className="rounded-card border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Zones</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Matched</TableHead>
              <TableHead>No drivers</TableHead>
              <TableHead>GMV</TableHead>
              <TableHead>p50 match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {zoneRows.map((zone) => (
              <TableRow key={`${zone.day}-${zone.zoneId}`}>
                <TableCell className="tabular-nums">{zone.day}</TableCell>
                <TableCell>{zone.zoneName}</TableCell>
                <TableCell className="tabular-nums">{zone.bookingsCreated}</TableCell>
                <TableCell className="tabular-nums">{zone.bookingsMatched}</TableCell>
                <TableCell className="tabular-nums">{zone.noDriversFound}</TableCell>
                <TableCell className="tabular-nums">
                  ₹{(zone.gmvPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="tabular-nums">
                  {zone.ttmP50Seconds === null ? '—' : `${zone.ttmP50Seconds}s`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.zones.length === 0 ? (
          <p className="text-sm text-text-secondary">No zone rows in this range.</p>
        ) : null}
      </div>
    </div>
  );
}
