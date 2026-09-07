import React, { useMemo } from 'react';
import { decodePolyline, type DriverJob } from '@towing/api-contracts';
import { MapPreview, type MapMarker, type MapPolyline } from '@towing/ui';
import { useLastFixStore } from '@/lib/location/lastFixStore';

/**
 * The FIRST MAP IN THIS APP (§9.2.3).
 *
 * TowPartner has never drawn one. `react-native-maps` went into both apps in
 * Phase 16 — its note said so at the time, "TowPartner draws no map until Phase
 * 18" — and `App.tsx` has called `configureMaps()` since then against a seam
 * nothing rendered. This is what it was for.
 *
 * IT IS A SMALL CARD, NOT A FULL-SCREEN MAP, and that is the whole design. §9.2.3
 * hands navigation off to the driver's own map app — a turn-by-turn view inside
 * MiTow Partner would be a worse Google Maps that also has to stay alive while
 * the OS wants to sleep the app, and would bill a Directions request per job on
 * top. What the driver needs HERE is orientation: where the pickup is relative
 * to them, and which way the job runs. Two hundred points of context, then out
 * to the app they already trust.
 *
 * ONE-SHOT CAMERA, no follow mode. The driver IS the moving marker, so a camera
 * that chased them would swing the card on every ping while they are trying to
 * read an address off it. `fitToMarkers` frames the job once and then leaves it
 * alone — which is exactly the Phase 16 behaviour, and exactly right here.
 */
export function JobMapCard({ job, height = 180 }: { job: DriverJob; height?: number }) {
  const fix = useLastFixStore((s) => s.fix);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [
      {
        key: 'pickup',
        coordinate: { latitude: job.pickup.lat, longitude: job.pickup.lng },
        tone: 'pickup',
      },
    ];

    if (job.drop) {
      out.push({
        key: 'drop',
        coordinate: { latitude: job.drop.lat, longitude: job.drop.lng },
        tone: 'drop',
      });
    }

    // The driver's own position, from the store the location task writes — not a
    // second GPS subscription. `showsUserLocation` would draw the OS blue dot
    // instead, but it would not be in the camera fit, so the driver could be off
    // screen on the one card meant to orient them.
    if (fix) {
      out.push({
        key: 'me',
        coordinate: { latitude: fix.lat, longitude: fix.lng },
        tone: 'driver',
        bearingDeg: fix.headingDeg ?? undefined,
        accuracyMeters: fix.accuracyM && fix.accuracyM > 50 ? fix.accuracyM : undefined,
      });
    }

    return out;
  }, [fix, job.drop, job.pickup]);

  const polylines = useMemo<MapPolyline[]>(() => {
    // The ACTIVE leg: to the pickup before the OTP, to the drop after it. The
    // same rule the customer's map follows, so the two sides of one trip are
    // never drawing different journeys.
    const encoded = job.status === 'in_progress' ? job.routeDropPolyline : job.routePolyline;
    if (!encoded) return [];

    const coordinates = decodePolyline(encoded).map((point) => ({
      latitude: point.lat,
      longitude: point.lng,
    }));
    if (coordinates.length < 2) return [];

    return [{ key: 'leg', coordinates, tone: 'route' }];
  }, [job.routeDropPolyline, job.routePolyline, job.status]);

  return (
    <MapPreview
      height={height}
      markers={markers}
      polylines={polylines}
      fitToMarkers
      // Not draggable: it is a thumbnail for orientation, and a map a driver can
      // pan is a map they will pan away from and then have to fix.
      interactive={false}
      showRecenter={false}
      style={{ borderRadius: 20, overflow: 'hidden' }}
      label="Job route"
    />
  );
}
