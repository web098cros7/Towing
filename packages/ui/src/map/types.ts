import type { ReactNode, Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { MapStyleElement } from 'react-native-maps';
import type { IconComponent } from '../types';

/** A WGS-84 point, in the shape both apps already use for coordinates. */
export type MapCoordinate = { latitude: number; longitude: number };

/**
 * A pin. Deliberately anonymous beyond a `key` and a `tone`.
 *
 * §11.9 forbids identity pre-assignment, so the nearby-driver markers the
 * customer's home screen draws carry no name, plate or rating — and a marker
 * type with fields for them would invite exactly that. Phase 18 added the two
 * fields below for the ASSIGNED case, where the driver is no longer anonymous
 * because the customer has been given their name; both are optional and the
 * anonymous callers pass neither, so §11.9's guarantee is unchanged.
 */
export type MapMarker = {
  key: string;
  coordinate: MapCoordinate;
  /**
   * `driver` renders the supply glyph, `pickup`/`drop` the route endpoints,
   * `user` the blue dot. Kept as a closed set rather than a free colour so two
   * screens cannot draw the same concept differently.
   */
  tone: 'driver' | 'pickup' | 'drop' | 'user';
  /**
   * Radius in metres of an uncertainty halo drawn under the marker. §11.9's
   * coarsened positions and §11.3's low-accuracy fixes both use it — a circle
   * sized to the error is honest where a precise dot is not.
   */
  accuracyMeters?: number;

  // --- Phase 18: the assigned driver ---------------------------------------

  /**
   * §11.4's "heading rotates the truck icon to match bearing".
   *
   * Degrees clockwise from north. Rendered with `rotation` + `flat` so the glyph
   * turns WITH the map rather than staying screen-upright — a marker that keeps
   * pointing north while the map rotates is worse than no bearing at all.
   *
   * Omit it (rather than passing 0) when the heading is unknown: 0 is a real
   * bearing and would confidently point a truck due north, which is exactly the
   * kind of quiet lie §11.3's accuracy halo exists to avoid.
   */
  bearingDeg?: number;

  /**
   * §11.6's "ghost" state. Dims the marker to say the position is old.
   *
   * A PROP RATHER THAN A TONE, because it is orthogonal: any marker can go
   * stale, and folding it into `tone` would double the closed set. The caller
   * decides by comparing the fix's age against `PRESENCE_STALE_MS` from
   * `@towing/api-contracts` — the thresholds are never redefined locally.
   */
  ghost?: boolean;
};

/**
 * §11.4's route line.
 *
 * TAKES DECODED POINTS, NOT AN ENCODED POLYLINE. `packages/ui` is deliberately
 * dependency-light and configuration-free, and decoding is the app's job — both
 * apps already receive the encoded string from the API and both have a decoder.
 * More usefully, a component that took a string could not draw a line the caller
 * had modified (trimming the travelled portion, say), and this way it can.
 */
export type MapPolyline = {
  key: string;
  coordinates: MapCoordinate[];
  /**
   * `route` is the driven road line, `direct` the straight fallback.
   *
   * `direct` renders DASHED, exactly as the Phase 5 fleet map draws its
   * un-routed job legs, and for the same reason: a solid line implies a road
   * somebody will actually drive. When Directions is unavailable the line is a
   * straight one between two points, and drawing it solid would send a customer
   * looking for a truck that is going to appear from a completely different
   * direction.
   */
  tone: 'route' | 'direct';

  // --- MiTow redesign: design-exact strokes (additive) ---------------------

  /**
   * Stroke colour override. Omit to keep the tone's theme colour. The MiTow
   * designs draw route strokes no tone matches: Home 07/08 `map/route` #858E9E,
   * Driver En Route 18 text/primary #0B0C0E.
   */
  color?: string;
  /** Stroke width override in dp. Omit to keep the tone's width (route 5, direct 3). */
  width?: number;
};

/**
 * A custom React view pinned to a map coordinate (MiTow redesign).
 *
 * This is how a screen draws what the design draws ON the map without this
 * package knowing the app's design system: the app builds the view (a black
 * `icon/map-pin`, the glowing truck, a `MiMapChip`, a `MiMapCallout`) and the
 * map keeps it on its coordinate while the customer pans and zooms.
 *
 * Rendered as a `react-native-maps` `<Marker>` with the view as its child. On
 * Google Maps a custom marker is a SNAPSHOT of the view, so:
 *
 * 1. It is not interactive and never receives touches.
 * 2. It is re-snapshotted only while `tracksViewChanges` is on. By default that
 *    is a short settle window after mount (so images and SVGs finish drawing)
 *    and again after every `contentKey` change, then off.
 * 3. Anything drawn outside the view's own bounds is clipped, shadows included.
 *    Wrap a shadowed view (MiMapChip) in a transparent padded View and compute
 *    the anchor against the padded box.
 *
 * Markers always draw above polylines on Google Maps.
 */
export type MapOverlay = {
  key: string;
  coordinate: MapCoordinate;
  /** The view to draw. Sized by its own layout. */
  view: ReactNode;
  /**
   * The point of the view that sits ON the coordinate, as fractions of the
   * view's width and height. Default `{ x: 0.5, y: 0.5 }` (centre).
   * Pin tip: `{ x: 0.5, y: 1 }`. A callout's tail tip: `{ x: tipX / width, y: 1 }`.
   */
  anchor?: { x: number; y: number };
  /** Stacking among markers and overlays; higher draws on top. */
  zIndex?: number;
  /**
   * Snapshot policy. Omit for the default (track during a settle window after
   * mount and after each `contentKey` change). `true` tracks always (only for a
   * view that animates); `false` never re-snapshots after the first frame.
   */
  tracksViewChanges?: boolean;
  /**
   * Changing this re-enables snapshotting for a settle window, so a view whose
   * content changed (an ETA callout going from "4 mins away" to "3 mins away")
   * redraws. Pass the dynamic text, for example.
   */
  contentKey?: string | number;
  /**
   * Degrees clockwise from north. When set, the view rotates WITH the map
   * (`flat`). Omit when unknown, exactly as for `MapMarker.bearingDeg`.
   */
  bearingDeg?: number;
  /** Include this coordinate in `fitToMarkers` and `controller.fitToContent()`. Default true. */
  includeInFit?: boolean;
  /** Screen-reader label for the marker. */
  accessibilityLabel?: string;
};

/**
 * Imperative camera handle (MiTow redesign) for the map buttons a screen draws
 * itself: Home's Recenter, 13's Locate me, 14's Recenter, 18's Locate me and
 * Recenter.
 *
 * Every method is a no-op until the native map is ready, and always a no-op on
 * the placeholder implementation.
 */
export type MapPreviewController = {
  /** Animate to a region (centre + span). */
  animateToRegion: (region: MapRegion, durationMs?: number) => void;
  /** Animate the centre to a coordinate, keeping the current zoom. */
  animateToCoordinate: (coordinate: MapCoordinate, durationMs?: number) => void;
  /** Frame a set of coordinates. `padding` falls back to `fitPadding`, then 64 per side. */
  fitToCoordinates: (
    coordinates: MapCoordinate[],
    options?: { padding?: MapFitPadding; animated?: boolean },
  ) => void;
  /** Frame every marker, polyline point and overlay (`includeInFit`), using `fitPadding`. */
  fitToContent: (options?: { animated?: boolean }) => void;
};

export type MapFitPadding = { top?: number; right?: number; bottom?: number; left?: number };

export type MapRegion = MapCoordinate & {
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapPreviewProps = {
  height?: number;
  showRecenter?: boolean;
  onRecenter?: () => void;
  recenterDisabled?: boolean;
  recenterIcon?: IconComponent;
  /** Render the user's position (blue dot + accuracy ring + label pill). */
  showUserLocation?: boolean;
  userLocationLabel?: string;
  /** Vertical position of the user marker; omit to center it in the map. */
  userMarkerTop?: number | `${number}%`;
  /** Watermark shown by the placeholder implementation. */
  label?: string;
  style?: StyleProp<ViewStyle>;

  // --- Phase 16: the real map ---------------------------------------------
  // Every field below is OPTIONAL and ignored by the placeholder, which is what
  // let the native implementation land behind this seam without touching the
  // four screens that already render `<MapPreview />`.

  /** Where to look. Uncontrolled after first render — pass `region` to drive it. */
  initialRegion?: MapRegion;
  /** Controlled camera. Changing it animates; the placeholder ignores it. */
  region?: MapRegion;
  markers?: MapMarker[];
  /**
   * Fit the camera to every marker plus the user, once, after the first frame
   * that has any.
   *
   * ONE-SHOT WHEN `followMode` IS ABSENT, which is what Phase 16 shipped and
   * what the four pre-existing callers still get: a camera that re-fits on every
   * ping fights the customer's pan. Phase 18's tracking screen opts into
   * continuous fitting by passing `followMode`, which comes with the pan-pause
   * that makes it survivable.
   */
  fitToMarkers?: boolean;

  // --- Phase 18: route lines and a camera that follows --------------------

  /** §11.4's route line(s). Ignored by the placeholder, like everything above. */
  polylines?: MapPolyline[];

  /**
   * §11.4's "auto-fits driver + pickup with padding; user pan pauses
   * auto-follow, a re-center chip restores it".
   *
   * THE HOST OWNS THE MODE, NOT THIS COMPONENT, and that is the important part
   * of the design. Pausing on pan is a two-part behaviour: the camera stops
   * following AND a chip appears offering to resume. The chip belongs to the
   * screen — it has to sit clear of a bottom sheet whose height the map knows
   * nothing about — so the state that drives both lives there too. This prop is
   * the camera half; `onUserPan` is the signal that flips it.
   *
   * `'fit'` re-frames on every marker change. `'paused'` leaves the camera
   * exactly where the customer put it. Omitting it entirely keeps Phase 16's
   * one-shot behaviour, so no existing caller changes.
   */
  followMode?: 'fit' | 'paused';

  /**
   * Fires when the user MOVES the map themselves — not when an animation does.
   *
   * The distinction is the whole difficulty of pan-pause. `onRegionChange` fires
   * for programmatic camera moves too, so wiring the pause to it means the
   * component's own auto-fit immediately pauses itself and the feature never
   * works. `react-native-maps` passes `isGesture` on the details argument
   * (Google provider), and where it is unavailable the implementation falls back
   * to ignoring changes that arrive while its own animation is in flight.
   */
  onUserPan?: () => void;

  /** Padding for the auto-fit, so a bottom sheet does not cover the markers. */
  fitPadding?: { top?: number; right?: number; bottom?: number; left?: number };
  /**
   * Fires as the camera starts moving. Paired with `onRegionChangeComplete`
   * because the pin screen has to know the label under the pin is STALE while a
   * pan is in flight — without it the sheet keeps showing the previous address
   * over a map that has already moved, and "Confirm" would accept a point the
   * customer is no longer looking at.
   */
  onRegionChange?: () => void;
  /** Fires after the user stops panning — the draggable-pin screen reads this. */
  onRegionChangeComplete?: (region: MapRegion) => void;
  /** Disables pan/zoom for the decorative cards that are not meant to be driven. */
  interactive?: boolean;

  // --- MiTow redesign (all optional; every existing default is unchanged) --
  // The placeholder ignores these, except `controllerRef`, which it fills with
  // no-ops so a screen's button handlers work the same on both paths.

  /**
   * Custom views anchored to coordinates: pins, the truck and its glow, map
   * chips and dark callouts. See `MapOverlay`. Drawn after `markers`.
   */
  overlays?: MapOverlay[];
  /** Receives the camera controller. Pass `useRef<MapPreviewController>(null)`. */
  controllerRef?: Ref<MapPreviewController>;
  /**
   * Insets the map's logical viewport, in dp. The Google logo and legal text
   * move inside it and the camera centre shifts with it. Use it to keep the
   * logo above a bottom sheet that covers the map's lower edge.
   */
  mapPadding?: MapFitPadding;
  /** Google Maps style JSON (Google provider only; Apple Maps ignores it). */
  customMapStyle?: MapStyleElement[];
  /** Fires once when the native map has finished its first layout. */
  onMapReady?: () => void;
};
