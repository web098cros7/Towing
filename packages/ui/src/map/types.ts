import type { StyleProp, ViewStyle } from 'react-native';
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
};

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
};
