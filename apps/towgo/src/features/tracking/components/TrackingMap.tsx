import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoutePin } from '@/features/booking/components/book-a-tow/RoutePin';
import { Platform, StyleSheet, View } from 'react-native';
import { useTheme } from '@towing/theme';
import {
  MapPreview,
  Text,
  usePressablePrimitive,
  type MapCoordinate,
  type MapFitPadding,
  type MapMarker,
  type MapOverlay,
  type MapPolyline,
  type MapPreviewController,
  type MapRegion,
} from '@towing/ui';
import { decodePolyline, type BookingTracking } from '@towing/api-contracts';
import { MiMapButton, mitowColors } from '@/design';
import {
  ARRIVED_CALLOUT_ANCHOR,
  ArrivedCallout,
  DRIVER_HERE_ANCHOR,
  DriverHereChip,
  YOUR_LOCATION_ANCHOR,
  YourLocationChip,
} from '@/screens/booking/tracking/ArrivedOverlays';
import { TowTruckIcon } from '@/components/TowTruckIcon';
import { routeFromTruck } from '@/screens/booking/tracking/routeGeometry';
import { useAnimatedPosition } from '../hooks/useAnimatedPosition';

/**
 * The live tracking map.
 *
 * One native map serves Figma 18, 19, 23, 24 and 25, so moving from one to the
 * next never reloads it (23 → 24 → 23 keeps the map mounted, as the owner asked):
 *
 * - `variant="enRoute"` is Figma 18 · Driver En Route's map (`229:235`), drawn
 *   on the real maps SDK: the green "Pickup Point" pin, the solid #0B0C0E 4.4
 *   route from the truck to the pin, the driver's small top-down truck turned
 *   to their heading (owner decision, 24 Sep 2026: no glow or callout, as Uber
 *   and Rapido draw it), and the Locate me / Recenter Map Controls pinned above
 *   the sheet. The map stops 29.2 below the sheet's top.
 * - `variant="arriving"` is Figma 19 · Driver Arriving. 19 draws a Placeholder;
 *   the owner chose 18's live content on it (truck, route, pin). Locate me and
 *   Recenter as 19 places them; the map stops 30 below the sheet's top.
 * - `variant="arrived"` is Figma 23 · Driver Arrived: only what 23 draws, the
 *   "Driver has arrived" callout on the driver and the "Your location" chip by
 *   the pickup. No truck, route or pin. Recenter only; 19.3 under the sheet.
 * - `variant="code"` is Figma 24 · Collection Code: only the "{first name} is
 *   here" chip on the driver. No controls; 24 under the sheet.
 * - `variant="inTransit"` is Figma 25 · Trip in Progress. 25 draws a Placeholder
 *   too, and the owner's 19 ruling carries over: 18's truck and route, but to
 *   the DROP, with the red drop pin. Locate me and Recenter as 25 places them;
 *   the map stops 21.6 below the sheet's top.
 * - `variant="legacy"` keeps the pre-redesign map for the statuses no rebuilt
 *   screen draws (a re-dispatch after a driver drops out, disputed): theme
 *   markers, pickup and drop, and a re-center chip while following is paused.
 */

export type TrackingMapVariant =
  'enRoute' | 'arriving' | 'arrived' | 'code' | 'inTransit' | 'legacy';

export interface TrackingMapProps {
  tracking: BookingTracking | undefined;
  /** `stale` and `offline` dim the legacy marker. */
  presence: 'live' | 'stale' | 'offline';
  variant: TrackingMapVariant;
  /** Screen y of the sheet's top edge (every rebuilt variant). */
  sheetTop: number;
  /** Space the legacy sheet occupies at the bottom (legacy). */
  bottomInset: number;
  /** 24's Driver chip label ("Rakesh is here"); `null` until the driver's name is known. */
  driverChipLabel?: string | null;
  /** Opens 26 · Emergency for this trip (the truck frames' upper map control). */
  onEmergency?: () => void;
}

type LiveVariant = Exclude<TrackingMapVariant, 'legacy'>;

/** How far each frame's map runs under the sheet's rounded top. */
const MAP_UNDER_SHEET: Record<LiveVariant, number> = {
  enRoute: 29.2, // 440 − 410.8
  arriving: 30, // 407.9 − 377.9
  arrived: 19.3, // 400 − 380.7
  code: 24, // 480 − 456
  inTransit: 21.6, // 410 − 388.4
};

/**
 * A frame with the truck on it (18, 19, 25): where its controls sit, and where
 * the camera puts the two ends of the trip.
 */
type TruckDesign = {
  /** The leg's end, where the pin sits and the route runs to: the pickup (18, 19) or the drop (25). */
  destination: 'pickup' | 'drop';
  /** The pin's accessibility label (not copy). */
  pinLabel: string;
  /** The drawn map frame's height on the 852 frame, and how far it runs under the sheet. */
  frameHeight: number;
  underSheet: number;
  /** Where the fit puts the truck centre and the pin tip (Figma screen points). */
  truck: { x: number; y: number };
  pinTip: { x: number; y: number };
  /** Left edge of the right-hand control column; the truck must stay clear of it. */
  columnX: number;
  /** Map Controls: distance from the screen's right edge, and from the button top to the sheet top. */
  locate: { right: number; above: number };
  recenter: { right: number; above: number };
};

/**
 * Figma 18 draws the two ends of the trip on its 393 × 440 map frame: the truck
 * centre at (92, 214) and the pin tip at (260.5, 358.5). Locate me `229:283` is
 * 50 at (327, 251), Recenter `229:288` 50 at (325.1, 311.7).
 */
const EN_ROUTE_DESIGN: TruckDesign = {
  destination: 'pickup',
  pinLabel: 'Your location',
  frameHeight: 440,
  underSheet: MAP_UNDER_SHEET.enRoute,
  truck: { x: 92, y: 214 },
  pinTip: { x: 260.5, y: 358.5 },
  columnX: 325.1,
  locate: { right: 16, above: 159.8 },
  recenter: { right: 17.9, above: 99.1 },
};

/**
 * Figma 19 draws no truck or pin, only the Arrival callout at (135, 109). With
 * the callout riding on the truck at 18's offset (left edge +19.7, top −82.8),
 * that places the truck centre at (115.3, 191.8), so the fit puts it there and
 * the callout lands exactly where 19 draws it. The pin keeps 18's height above
 * the sheet (52.3): 377.9 − 52.3 = 325.6. Locate me `254:1530` is 50 at
 * (327, 242), Recenter `254:1535` 50 at (327, 304).
 */
const ARRIVING_DESIGN: TruckDesign = {
  destination: 'pickup',
  pinLabel: 'Your location',
  frameHeight: 407.9,
  underSheet: MAP_UNDER_SHEET.arriving,
  truck: { x: 135 - 19.7, y: 109 + 82.8 },
  pinTip: { x: 260.5, y: 377.9 - (410.8 - 358.5) },
  columnX: 327,
  locate: { right: 16, above: 135.9 },
  recenter: { right: 16, above: 73.9 },
};

/**
 * Figma 25 draws no truck or pin either, only the Drop callout at (98.6, 126.1),
 * so the truck centre goes where that places it with 18's offset: (78.9, 208.9).
 * The pin is on the DROP and keeps 18's height above the sheet (52.3) and 18's
 * x: 388.4 − 52.3 = 336.1. The map frame is 410 tall. Locate me `236:474` is 50
 * at (327.9, 248), Recenter `236:479` 50 at (327.9, 309.5): right 15.1.
 */
const IN_TRANSIT_DESIGN: TruckDesign = {
  destination: 'drop',
  pinLabel: 'Drop location',
  frameHeight: 410,
  underSheet: MAP_UNDER_SHEET.inTransit,
  truck: { x: 98.6 - 19.7, y: 126.1 + 82.8 },
  pinTip: { x: 260.5, y: 388.4 - (410.8 - 358.5) },
  columnX: 327.9,
  locate: { right: 15.1, above: 140.4 },
  recenter: { right: 15.1, above: 78.9 },
};

/**
 * Camera framing: fitting truck, pin and route into the rectangle between the
 * drawn truck centre and pin tip reproduces the drawn layout whenever the
 * route's box has the drawn proportions, and keeps both ends there otherwise
 * (the longer side fills, the other centres).
 *
 * The drawn arrangement has the truck up and to the left of the pin. When the
 * truck is to the pin's RIGHT, the same insets would put it under the control
 * column, so it is held a truck's width left of the column, and the pin tip
 * keeps its half-width clear of the 16 side margin (left inset 32).
 *
 * The bottom inset is measured from the map frame's bottom. Google Maps on
 * Android ADDS the fit padding to the map padding (`appendMapPadding`), Apple
 * Maps does not, so Android subtracts the part already under the sheet.
 */
function fitPaddingFor(design: TruckDesign, truckRightOfPin: boolean): MapFitPadding {
  const pinBottom = design.frameHeight - design.pinTip.y;
  const bottom = Platform.OS === 'android' ? pinBottom - design.underSheet : pinBottom;
  const sides = truckRightOfPin
    ? { left: 32, right: 393 - (design.columnX - TRUCK_SIZE) }
    : { left: design.truck.x, right: 393 - design.pinTip.x };
  // Whole dp: the Android bridge reads these with `getInt`.
  return {
    top: Math.round(design.truck.y),
    right: Math.round(sides.right),
    bottom: Math.round(bottom),
    left: Math.round(sides.left),
  };
}

/**
 * The driver's truck on the map (owner decision, 24 Sep 2026): a small top-down
 * truck of its own kind, the same size at every zoom, turned by the native marker
 * to the driver's heading as Uber and Rapido draw theirs. Figma's glow, route
 * stub and callout bubble are gone.
 */
// 34, grown 15% then 10% more (owner, 26 Sep 2026).
const TRUCK_SIZE = 34 * 1.15 * 1.1;
/** The route line, Figma 18 `229:257`: text/primary, 4.4. */
const ROUTE_STROKE = { color: mitowColors.textPrimary, width: 4.4 };

/** Stable objects: a new one per render would re-frame the camera every render. */
const FIT_PADDING = {
  enRoute: {
    truckLeft: fitPaddingFor(EN_ROUTE_DESIGN, false),
    truckRight: fitPaddingFor(EN_ROUTE_DESIGN, true),
  },
  arriving: {
    truckLeft: fitPaddingFor(ARRIVING_DESIGN, false),
    truckRight: fitPaddingFor(ARRIVING_DESIGN, true),
  },
  inTransit: {
    truckLeft: fitPaddingFor(IN_TRANSIT_DESIGN, false),
    truckRight: fitPaddingFor(IN_TRANSIT_DESIGN, true),
  },
};
const EN_ROUTE_MAP_PADDING = { bottom: MAP_UNDER_SHEET.enRoute };
const ARRIVING_MAP_PADDING = { bottom: MAP_UNDER_SHEET.arriving };
const IN_TRANSIT_MAP_PADDING = { bottom: MAP_UNDER_SHEET.inTransit };

/**
 * 23: the camera puts the driver where the callout's tail tip is drawn,
 * (232.4, 196.3): 35.9 right of the screen centre and 184.4 above the sheet's
 * top. The map padding moves the camera centre there (padded viewport left
 * 71.8, top sheetTop − 368.8, bottom the 19.3 under the sheet).
 */
const ARRIVED_FOCUS = { rightOfCentre: 232.4 - 393 / 2, aboveSheet: 380.7 - 196.3 };
/** 24: the chip's centre is drawn at (196.5, 316): centred, 140 above the sheet's top. */
const CODE_FOCUS_ABOVE_SHEET = 456 - 316;

/** Below this spread a bounds fit would zoom to street level; frame a fixed span instead. */
const MIN_FIT_SPREAD_DEG = 0.0005;
/** 18's close framing, also 23's and 24's street-level span (no zoom is drawn on either). */
const CLOSE_SPAN_DEG = 0.005;

export function TrackingMap(props: TrackingMapProps) {
  return props.variant === 'legacy' ? (
    <LegacyMap {...props} />
  ) : (
    <LiveTripMap {...props} variant={props.variant} />
  );
}

/**
 * The server's road route for a leg: `routePolyline` to the pickup,
 * `routeDropPolyline` (pickup → drop, planned once at assignment) to the drop.
 * Without a leg, the one the status says is active.
 */
function useActiveRoute(
  tracking: BookingTracking | undefined,
  leg: 'pickup' | 'drop' = tracking?.status === 'in_progress' ? 'drop' : 'pickup',
): MapCoordinate[] | null {
  const encoded = tracking
    ? leg === 'drop'
      ? tracking.routeDropPolyline
      : tracking.routePolyline
    : null;

  return useMemo(() => {
    if (!encoded) return null;
    const coordinates = decodePolyline(encoded).map((point) => ({
      latitude: point.lat,
      longitude: point.lng,
    }));
    return coordinates.length < 2 ? null : coordinates;
  }, [encoded]);
}

function LiveTripMap({
  tracking,
  sheetTop,
  variant,
  driverChipLabel = null,
  onEmergency,
}: TrackingMapProps & { variant: LiveVariant }) {
  const map = useRef<MapPreviewController>(null);
  const [ready, setReady] = useState(false);
  /**
   * The step the customer paused camera following in (by panning 18, 19, 23 or
   * 25, or Locate me; 24 never pauses). Following is per step: each step opens
   * following, and the camera effect drops the pause when a step opens.
   */
  const [pausedIn, setPausedIn] = useState<LiveVariant | null>(null);
  const following = pausedIn !== variant;
  const animated = useAnimatedPosition(tracking?.position ?? null);

  /** 18, 19 and 25 carry the truck, the route and the pin; 23 and 24 carry neither. */
  const truckDesign =
    variant === 'enRoute'
      ? EN_ROUTE_DESIGN
      : variant === 'arriving'
        ? ARRIVING_DESIGN
        : variant === 'inTransit'
          ? IN_TRANSIT_DESIGN
          : null;
  const serverRoute = useActiveRoute(tracking, truckDesign?.destination ?? 'pickup');

  const pickupLat = tracking?.pickup.lat;
  const pickupLng = tracking?.pickup.lng;
  const pickup = useMemo<MapCoordinate | null>(
    () =>
      pickupLat === undefined || pickupLng === undefined
        ? null
        : { latitude: pickupLat, longitude: pickupLng },
    [pickupLat, pickupLng],
  );

  const dropLat = tracking?.drop?.lat;
  const dropLng = tracking?.drop?.lng;
  const drop = useMemo<MapCoordinate | null>(
    () =>
      dropLat === undefined || dropLng === undefined
        ? null
        : { latitude: dropLat, longitude: dropLng },
    [dropLat, dropLng],
  );

  /**
   * The truck frames' pin: the pickup on 18 and 19, the drop on 25. A booking
   * with no drop (roadside help) has none on 25, so no pin and no route (data gap).
   */
  const destination = truckDesign?.destination === 'drop' ? drop : pickup;

  const fixLat = tracking?.position?.lat;
  const fixLng = tracking?.position?.lng;
  const fix = useMemo<MapCoordinate | null>(
    () =>
      fixLat === undefined || fixLng === undefined ? null : { latitude: fixLat, longitude: fixLng },
    [fixLat, fixLng],
  );

  /**
   * The route is always drawn truck → pin, as the design draws it: the server's
   * road route for the leg, or a straight line from the driver's fix to the pin
   * when the server has none. Solid in both cases; the design draws no dashed
   * state.
   */
  const route = useMemo<MapCoordinate[] | null>(() => {
    if (!destination) return null;
    if (serverRoute) return serverRoute;
    return fix ? [fix, destination] : null;
  }, [destination, fix, serverRoute]);

  const [initialRegion] = useState<MapRegion | undefined>(() =>
    tracking
      ? {
          latitude: tracking.pickup.lat,
          longitude: tracking.pickup.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }
      : undefined,
  );

  const truckLat = animated?.lat;
  const truckLng = animated?.lng;

  /** The route from the truck's current point on it to the pin. */
  const routePath = useMemo(() => {
    if (truckLat === undefined || truckLng === undefined || !route) return null;
    return routeFromTruck(route, { latitude: truckLat, longitude: truckLng });
  }, [route, truckLat, truckLng]);

  // The truck is drawn once, facing north; the native marker turns it to the
  // heading (`bearingDeg` → rotation + flat), so it turns smoothly with no redraw.
  const truckClass = tracking?.driver?.vehicleClass ?? null;
  // Known once any ping carried a heading or the truck has visibly moved, so a
  // ping without one never turns it back to north.
  const truckBearing = animated?.headingKnown ? animated.heading : undefined;
  const truckView = useMemo(
    () => <TowTruckIcon vehicleClass={truckClass} headingDeg={null} size={TRUCK_SIZE} />,
    [truckClass],
  );
  // The trip end the truck is heading for, as the booking map marks it (owner decision,
  // 24 Sep 2026): the green "Pickup Point" on the way to the customer, the red drop
  // after. Figma draws a plain map-pin.
  const pinKind = truckDesign?.destination === 'drop' ? 'drop' : 'pickup';
  const pinView = useMemo(
    () => <RoutePin kind={pinKind} label={pinKind === 'drop' ? 'Drop location' : 'Pickup Point'} />,
    [pinKind],
  );
  const arrivedCalloutView = useMemo(() => <ArrivedCallout />, []);
  const yourLocationView = useMemo(() => <YourLocationChip />, []);
  const driverHereView = useMemo(
    () => (driverChipLabel ? <DriverHereChip label={driverChipLabel} /> : null),
    [driverChipLabel],
  );

  /** 23's callout and 24's chip sit on the driver; before a first fix, on the pickup (they meet at arrival). */
  const driverPoint = useMemo<MapCoordinate | null>(
    () =>
      truckLat !== undefined && truckLng !== undefined
        ? { latitude: truckLat, longitude: truckLng }
        : pickup,
    [pickup, truckLat, truckLng],
  );

  const overlays = useMemo<MapOverlay[]>(() => {
    const out: MapOverlay[] = [];

    if (truckDesign) {
      if (destination) {
        out.push({
          key: 'destination',
          coordinate: destination,
          view: pinView,
          // The pin's stem foot touches the point.
          anchor: { x: 0.5, y: 1 },
          contentKey: pinKind,
          zIndex: 1,
          accessibilityLabel: truckDesign.pinLabel,
        });
      }
      if (truckLat !== undefined && truckLng !== undefined) {
        out.push({
          key: 'truck',
          coordinate: { latitude: truckLat, longitude: truckLng },
          view: truckView,
          anchor: { x: 0.5, y: 0.5 },
          bearingDeg: truckBearing,
          zIndex: 2,
          contentKey: truckClass ?? 'truck',
          accessibilityLabel: 'Tow truck',
        });
      }
      return out;
    }

    if (variant === 'arrived') {
      // Decorative: the heading already says both (23 build note 9). 23 layers the
      // "Your location" chip ABOVE the arrival callout, so the chip draws on top.
      if (pickup) {
        out.push({
          key: 'yourLocation',
          coordinate: pickup,
          view: yourLocationView,
          anchor: YOUR_LOCATION_ANCHOR,
          zIndex: 2,
        });
      }
      if (driverPoint) {
        out.push({
          key: 'arrivedCallout',
          coordinate: driverPoint,
          view: arrivedCalloutView,
          anchor: ARRIVED_CALLOUT_ANCHOR,
          zIndex: 1,
        });
      }
      return out;
    }

    // 24: hidden until the driver's name is known (no first name to put in the label).
    if (driverPoint && driverHereView && driverChipLabel) {
      out.push({
        key: 'driverHere',
        coordinate: driverPoint,
        view: driverHereView,
        anchor: DRIVER_HERE_ANCHOR,
        zIndex: 1,
        contentKey: driverChipLabel,
        accessibilityLabel: driverChipLabel,
      });
    }
    return out;
  }, [
    pinKind,
    truckBearing,
    truckClass,
    arrivedCalloutView,
    destination,
    driverChipLabel,
    driverHereView,
    driverPoint,
    pickup,
    pinView,
    truckDesign,
    truckLat,
    truckLng,
    truckView,
    variant,
    yourLocationView,
  ]);

  const polylines = useMemo<MapPolyline[]>(() => {
    if (!truckDesign || !routePath || routePath.length < 2) return [];
    return [
      {
        key: 'route',
        coordinates: routePath,
        tone: 'route',
        color: ROUTE_STROKE.color,
        width: ROUTE_STROKE.width,
      },
    ];
  }, [routePath, truckDesign]);

  const underSheet = MAP_UNDER_SHEET[variant];

  /** Round numbers: the camera centre only needs whole points. */
  const mapPadding = useMemo(() => {
    if (variant === 'enRoute') return EN_ROUTE_MAP_PADDING;
    if (variant === 'arriving') return ARRIVING_MAP_PADDING;
    if (variant === 'inTransit') return IN_TRANSIT_MAP_PADDING;
    if (variant === 'arrived') {
      return {
        top: Math.max(0, Math.round(sheetTop - 2 * ARRIVED_FOCUS.aboveSheet)),
        left: Math.round(2 * ARRIVED_FOCUS.rightOfCentre),
        bottom: underSheet,
      };
    }
    return {
      top: Math.max(0, Math.round(sheetTop - 2 * CODE_FOCUS_ABOVE_SHEET)),
      bottom: underSheet,
    };
  }, [sheetTop, underSheet, variant]);

  // --- Camera ---------------------------------------------------------------

  const truckRightOfPin =
    fix !== null && destination !== null && fix.longitude > destination.longitude;
  const fitPaddings =
    variant === 'arriving'
      ? FIT_PADDING.arriving
      : variant === 'inTransit'
        ? FIT_PADDING.inTransit
        : FIT_PADDING.enRoute;
  const fitPadding = truckRightOfPin ? fitPaddings.truckRight : fitPaddings.truckLeft;

  /** Truck, pin and the whole route (not the trimmed polyline), from the latest fix. */
  const fitCoordinates = useMemo<MapCoordinate[]>(() => {
    const out: MapCoordinate[] = [];
    if (fix) out.push(fix);
    if (destination) out.push(destination);
    if (route) out.push(...route);
    return out;
  }, [destination, fix, route]);

  /** 23 and 24 centre on the driver's latest fix, or on the pickup before one. */
  const focus = fix ?? pickup;

  /**
   * `reset` sets the zoom (entering a step, Recenter, or a new map height);
   * otherwise 23 and 24 only move the centre, keeping the customer's zoom.
   */
  const frame = useCallback(
    (reset: boolean) => {
      if (!truckDesign) {
        if (!focus) return;
        if (!reset) {
          map.current?.animateToCoordinate(focus);
          return;
        }
        // 23: a driver still some way off keeps the pickup in view too.
        const spread =
          variant === 'arrived' && pickup
            ? Math.max(
                Math.abs(focus.latitude - pickup.latitude),
                Math.abs(focus.longitude - pickup.longitude),
              )
            : 0;
        const span = Math.max(CLOSE_SPAN_DEG, spread * 3);
        map.current?.animateToRegion({
          latitude: focus.latitude,
          longitude: focus.longitude,
          latitudeDelta: span,
          longitudeDelta: span,
        });
        return;
      }

      const first = fitCoordinates[0];
      if (!first) return;
      const lats = fitCoordinates.map((c) => c.latitude);
      const lngs = fitCoordinates.map((c) => c.longitude);
      const spread = Math.max(
        Math.max(...lats) - Math.min(...lats),
        Math.max(...lngs) - Math.min(...lngs),
      );
      if (spread < MIN_FIT_SPREAD_DEG) {
        map.current?.animateToRegion({
          latitude: first.latitude,
          longitude: first.longitude,
          latitudeDelta: CLOSE_SPAN_DEG,
          longitudeDelta: CLOSE_SPAN_DEG,
        });
        return;
      }
      map.current?.fitToCoordinates(fitCoordinates, { padding: fitPadding, animated: true });
    },
    [fitCoordinates, fitPadding, focus, pickup, truckDesign, variant],
  );

  const mapHeight = Math.max(0, sheetTop + underSheet);
  /** Whole points, so sub-point layout drift does not re-frame the camera. */
  const mapHeightPt = Math.round(mapHeight);

  /**
   * Follows the trip while following: every new fix or route re-frames it. A
   * step is framed afresh when it opens, following again: a pause left from an
   * earlier step is dropped then, so 23 panned → 24 → back to 23 follows again.
   * 24 draws no Recenter, so a pan there never pauses it (`onUserPan`): it
   * re-centres on each new fix, not mid-pan (24 build note 4).
   *
   * A change in the map's height re-frames too (with the zoom reset), because the
   * framing is only right for the map it was made against. It lands just after a
   * step opens, when the new sheet's measured height replaces its drawn one.
   *
   * ONE camera call per change: a second call would cut the first animation
   * short, and a zoom cut short stays wherever it stopped.
   */
  const framedVariant = useRef<LiveVariant | null>(null);
  const framedHeight = useRef<number | null>(null);
  const resetOnResume = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const entering = framedVariant.current !== variant;
    const resized = framedHeight.current !== mapHeightPt;
    framedHeight.current = mapHeightPt;
    if (entering) {
      framedVariant.current = variant;
      setPausedIn(null);
      if (!following) {
        // Dropping the pause re-runs this effect; frame there, once, with the zoom reset.
        resetOnResume.current = true;
        return;
      }
    } else if (!following) {
      return;
    }
    const reset = entering || resized || resetOnResume.current;
    resetOnResume.current = false;
    frame(reset);
  }, [following, frame, mapHeightPt, ready, variant]);

  const onMapReady = useCallback(() => setReady(true), []);
  const onUserPan = useCallback(() => {
    if (variant !== 'code') setPausedIn(variant);
  }, [variant]);

  const onRecenter = useCallback(() => {
    if (following) {
      frame(true);
      return;
    }
    // Resuming re-frames through the effect above, with the zoom reset.
    resetOnResume.current = true;
    setPausedIn(null);
  }, [following, frame]);

  return (
    <>
      <MapPreview
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: mapHeight }}
        controllerRef={map}
        initialRegion={initialRegion}
        overlays={overlays}
        polylines={polylines}
        onMapReady={onMapReady}
        onUserPan={onUserPan}
        mapPadding={mapPadding}
        showRecenter={false}
        showUserLocation={false}
        userLocationLabel=""
        label=""
      />

      {/*
        Emergency, in Locate me's place: 18 `229:283` 50 at (327, 251), right 16 and
        159.8 above the sheet; 19 `254:1530` 50 at (327, 242), right 16 and 135.9
        above; 25 `236:474` 50 at (327.9, 248), right 15.1 and 140.4 above. Locate me
        and Recenter did the same job on a trip map, so Locate me became the way to
        26 · Emergency (owner, 25 Sep 2026).
      */}
      {truckDesign && onEmergency ? (
        <MiMapButton
          colorIcon="siren"
          size={50}
          iconSize={28}
          accessibilityLabel="Emergency"
          onPress={onEmergency}
          style={{
            position: 'absolute',
            right: truckDesign.locate.right,
            top: sheetTop - truckDesign.locate.above,
          }}
        />
      ) : null}
      {/*
        Recenter: 18 `229:288` 50 at (325.1, 311.7), right 17.9 and 99.1 above the sheet;
        19 `254:1535` 50 at (327, 304), right 16 and 73.9 above the sheet;
        23 `236:387` 50 at (326.3, 309.5), right 16.7 and 71.2 above the sheet;
        25 `236:479` 50 at (327.9, 309.5), right 15.1 and 78.9 above the sheet.
        24 draws none.
      */}
      {truckDesign ? (
        <MiMapButton
          icon="navigation"
          size={50}
          accessibilityLabel="Recenter"
          onPress={onRecenter}
          style={{
            position: 'absolute',
            right: truckDesign.recenter.right,
            top: sheetTop - truckDesign.recenter.above,
          }}
        />
      ) : variant === 'arrived' ? (
        <MiMapButton
          icon="navigation"
          size={50}
          accessibilityLabel="Recenter"
          onPress={onRecenter}
          style={{ position: 'absolute', right: 16.7, top: sheetTop - 71.2 }}
        />
      ) : null}
    </>
  );
}

function LegacyMap({ tracking, presence, bottomInset }: TrackingMapProps) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const [following, setFollowing] = useState(true);
  const animated = useAnimatedPosition(tracking?.position ?? null);
  const route = useActiveRoute(tracking);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    if (animated) {
      out.push({
        key: 'driver',
        coordinate: { latitude: animated.lat, longitude: animated.lng },
        tone: 'driver',
        bearingDeg: animated.headingKnown ? animated.heading : undefined,
        ghost: presence !== 'live',
        accuracyMeters: tracking?.position?.lowAccuracy ? 60 : undefined,
      });
    }
    if (tracking) {
      out.push({
        key: 'pickup',
        coordinate: { latitude: tracking.pickup.lat, longitude: tracking.pickup.lng },
        tone: 'pickup',
      });
      if (tracking.drop) {
        out.push({
          key: 'drop',
          coordinate: { latitude: tracking.drop.lat, longitude: tracking.drop.lng },
          tone: 'drop',
        });
      }
    }
    return out;
  }, [animated, presence, tracking]);

  const polylines = useMemo<MapPolyline[]>(() => {
    if (!route || !tracking) return [];
    return [
      {
        key: 'route',
        coordinates: route,
        tone: tracking.etaSource === 'google_directions' ? 'route' : 'direct',
      },
    ];
  }, [route, tracking]);

  const onUserPan = useCallback(() => setFollowing(false), []);
  const onRecenter = useCallback(() => setFollowing(true), []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapPreview
        style={StyleSheet.absoluteFill}
        markers={markers}
        polylines={polylines}
        fitToMarkers
        followMode={following ? 'fit' : 'paused'}
        onUserPan={onUserPan}
        fitPadding={{ top: 96, right: 56, bottom: bottomInset + 32, left: 56 }}
        showRecenter={false}
        label=""
      />

      {!following ? (
        <View style={[styles.chipWrap, { bottom: bottomInset + 16 }]} pointerEvents="box-none">
          <Pressable
            onPress={onRecenter}
            pressScale={theme.motion.pressScale.chip}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel="Re-center on your driver"
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.radii.pill,
              paddingHorizontal: 14,
              paddingVertical: 8,
              ...theme.shadows.fab,
            }}
          >
            <Text
              weight="medium"
              style={{ fontSize: 13, lineHeight: 18, color: theme.colors.brand }}
            >
              Re-center
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chipWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
