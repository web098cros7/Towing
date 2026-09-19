import React from 'react';
import { isNativeMapAvailable } from './config';
import { MapPreviewMaps } from './MapPreview.maps';
import { MapPreviewPlaceholder } from './MapPreview.placeholder';
import type { MapPreviewProps } from './types';

export type {
  MapPreviewProps,
  MapMarker,
  MapCoordinate,
  MapRegion,
  MapOverlay,
  MapPreviewController,
  MapFitPadding,
} from './types';
export { configureMaps, isNativeMapAvailable, type MapConfig } from './config';

/**
 * Map facade — the seam this file's header promised since Phase 12: "point this
 * at a react-native-maps implementation (`MapPreview.maps`) with the same props
 * — no consumer changes required". Phase 16 does exactly that, and no consumer
 * changed: the four screens already rendering `<MapPreview />` were not touched
 * to make the map appear.
 *
 * Which implementation runs is decided by `configureMaps()`, called once at app
 * boot — see `config.ts` for why that is a slot rather than an env read.
 *
 * ⚠ NEVER OBSERVED ON A DEVICE. `react-native-maps` is a native module and no
 * dev client has been built for either app, so the native path is typechecked,
 * bundle-clean and prebuild-clean, and has never drawn a tile. Same honest
 * standing as Phase 13's push adapters. See `tobedone.md`.
 */
export function MapPreview(props: MapPreviewProps) {
  // Read per render, not at module scope: `configureMaps` runs during app boot,
  // and a module-scope constant would capture the value from before it was set.
  return isNativeMapAvailable() ? (
    <MapPreviewMaps {...props} />
  ) : (
    <MapPreviewPlaceholder {...props} />
  );
}
