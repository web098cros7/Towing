'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminLiveBooking, AdminLiveDriver } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { useThemeMode } from '@/lib/useThemeMode';
import { mapColors } from '@/features/realtime/lib/mapColors';
import { vendorlessStyle } from '@/features/realtime/lib/mapStyle';
import type { FleetZone } from '@/features/realtime/types';
import {
  ADMIN_BOOKINGS_SOURCE,
  ADMIN_BOOKING_PICKUP_LAYER,
  ADMIN_DRIVER_DOT_LAYER,
  ADMIN_DRIVER_HALO_LAYER,
  ADMIN_DRIVERS_SOURCE,
  ADMIN_HEADINGS_SOURCE,
  ADMIN_LEGS_SOURCE,
  ADMIN_ZONES_SOURCE,
  addAdminLayers,
  adminZonesToGeoJson,
  applyAdminColors,
  bookingLegsToGeoJson,
  bookingPickupsToGeoJson,
  driverHeadingsToGeoJson,
  driversToGeoJson,
} from '../lib/adminMapLayers';
import { DriverPositionAnimator } from '../lib/driverAnimator';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface AdminLiveMapCanvasProps {
  drivers: AdminLiveDriver[];
  bookings: AdminLiveBooking[];
  zones: FleetZone[];
  selectedDriverId: string | null;
  selectedBookingId: string | null;
  onSelect: (selection: { driverId: string | null; bookingId: string | null }) => void;
}

/** Bengaluru (§2 persona city) — where the camera starts before any data lands. */
const FALLBACK_CENTER: [number, number] = [77.5946, 12.9716];

/**
 * The admin live map (W4 §9.4.6) — the fleet canvas forked for a platform-wide
 * view: driver markers with presence semantics, a booking-pickup layer, and a
 * dashed driver→pickup leg per assigned job. It reuses the fleet's vendorless
 * basemap, colour tokens and tween maths; the pieces that differ (id
 * vocabulary, drivers-instead-of-trucks, bookings) live in `adminMapLayers`.
 *
 * WebGL-unavailable degrades to a labelled panel, never a blank box — the
 * caller keeps the rail and the panels usable, which is what the operator
 * actually needs in that case.
 */
export default function AdminLiveMapCanvas({
  drivers,
  bookings,
  zones,
  selectedDriverId,
  selectedBookingId,
  onSelect,
}: AdminLiveMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const animatorRef = useRef(new DriverPositionAnimator());
  const driversRef = useRef(drivers);
  const bookingsRef = useRef(bookings);
  const frameRef = useRef<number | null>(null);
  const hasFittedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const mode = useThemeMode();

  driversRef.current = drivers;
  bookingsRef.current = bookings;

  /** Drivers with an active booking — the marker's colour says "on job". */
  const onJobDriverIds = useMemo(
    () => new Set(bookings.map((booking) => booking.driverId).filter((id): id is string => !!id)),
    [bookings],
  );

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

    mapRef.current = map;
    map.on('error', () => {
      /* tile/style errors are non-fatal for a vendorless style */
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      addAdminLayers(map, mapColors(mode));
      setReady(true);
    });

    map.on('click', ADMIN_DRIVER_DOT_LAYER, (event) => {
      const driverId = event.features?.[0]?.properties?.driverId;
      if (typeof driverId === 'string') onSelect({ driverId, bookingId: null });
    });
    map.on('click', ADMIN_BOOKING_PICKUP_LAYER, (event) => {
      const bookingId = event.features?.[0]?.properties?.bookingId;
      if (typeof bookingId === 'string') onSelect({ driverId: null, bookingId });
    });
    // Clicking empty map dismisses the panel — the standard escape hatch.
    map.on('click', (event) => {
      const hits = map.queryRenderedFeatures(event.point, {
        layers: [ADMIN_DRIVER_DOT_LAYER, ADMIN_BOOKING_PICKUP_LAYER].filter((layer) =>
          map.getLayer(layer),
        ),
      });
      if (hits.length === 0) onSelect({ driverId: null, bookingId: null });
    });
    for (const layer of [ADMIN_DRIVER_DOT_LAYER, ADMIN_BOOKING_PICKUP_LAYER]) {
      for (const [type, cursor] of [
        ['mouseenter', 'pointer'],
        ['mouseleave', ''],
      ] as const) {
        map.on(type, layer, () => {
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
    // Created once: `mode` is read at construction and maintained imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyAdminColors(map, mapColors(mode));
  }, [mode, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(ADMIN_ZONES_SOURCE);
    if (source && 'setData' in source) {
      (source as maplibregl.GeoJSONSource).setData(adminZonesToGeoJson(zones) as never);
    }
  }, [zones, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    animatorRef.current.update(drivers, Date.now());

    if (!hasFittedRef.current) {
      const points: Array<[number, number]> = [];
      for (const driver of drivers) {
        if (driver.lat !== null && driver.lng !== null) points.push([driver.lng, driver.lat]);
      }
      for (const booking of bookings) points.push([booking.pickup.lng, booking.pickup.lat]);
      if (points.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const point of points) bounds.extend(point);
        map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
        // Fit once: re-fitting on every batch would fight the operator's pan.
        hasFittedRef.current = true;
      }
    }

    const draw = () => {
      const now = Date.now();
      const frames = animatorRef.current.frames(now);
      const nowMs = Date.now();

      const driversSource = map.getSource(ADMIN_DRIVERS_SOURCE);
      if (driversSource && 'setData' in driversSource) {
        (driversSource as maplibregl.GeoJSONSource).setData(
          driversToGeoJson(driversRef.current, nowMs, frames, onJobDriverIds) as never,
        );
      }
      const headingsSource = map.getSource(ADMIN_HEADINGS_SOURCE);
      if (headingsSource && 'setData' in headingsSource) {
        (headingsSource as maplibregl.GeoJSONSource).setData(
          driverHeadingsToGeoJson(driversRef.current, nowMs, frames) as never,
        );
      }
      const bookingsSource = map.getSource(ADMIN_BOOKINGS_SOURCE);
      if (bookingsSource && 'setData' in bookingsSource) {
        (bookingsSource as maplibregl.GeoJSONSource).setData(
          bookingPickupsToGeoJson(bookingsRef.current) as never,
        );
      }
      const legsSource = map.getSource(ADMIN_LEGS_SOURCE);
      if (legsSource && 'setData' in legsSource) {
        (legsSource as maplibregl.GeoJSONSource).setData(
          bookingLegsToGeoJson(bookingsRef.current, driversRef.current, frames) as never,
        );
      }

      frameRef.current = animatorRef.current.isAnimating(now) ? requestAnimationFrame(draw) : null;
    };

    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [drivers, bookings, ready, onJobDriverIds]);

  // Centre on the selected marker without changing zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (selectedDriverId) {
      const driver = drivers.find((entry) => entry.driverId === selectedDriverId);
      if (driver?.lat != null && driver.lng != null) {
        map.easeTo({ center: [driver.lng, driver.lat], duration: 400 });
      }
      return;
    }
    if (selectedBookingId) {
      const booking = bookings.find((entry) => entry.bookingId === selectedBookingId);
      if (booking) {
        map.easeTo({ center: [booking.pickup.lng, booking.pickup.lat], duration: 400 });
      }
    }
  }, [selectedDriverId, selectedBookingId, drivers, bookings, ready]);

  if (failed) {
    return (
      <div
        data-testid="admin-map-unavailable"
        className="flex h-full items-center justify-center rounded-card bg-map-bg p-6 text-center text-sm text-text-secondary dark:bg-surface1"
      >
        This browser cannot render the map (WebGL unavailable). Drivers and bookings are still
        listed alongside.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="admin-map"
      className="h-full w-full overflow-hidden rounded-card bg-map-bg dark:bg-surface1"
    />
  );
}
