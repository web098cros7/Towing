'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@towing/web-ui';
import type { TrackMapCanvasProps } from './TrackMapCanvas';

/**
 * The public share page's map seam.
 *
 * `ssr: false`, for the same reason `<FleetMap>` is: MapLibre touches `window`
 * and WebGL at import time and can never run during SSR. A guard inside the
 * component would not help — the import itself is the problem.
 *
 * A SEPARATE CANVAS FROM `FleetMapCanvas`, deliberately. That one carries the
 * console's whole surface: fleet-scoped truck layers, zone polygons, status and
 * driver filters, a click-to-side-panel handler, the rAF interpolation loop and
 * a `positionsRef` shared with a socket. This page has one marker, one line and
 * no interaction, and the shortest path to leaking something into a public page
 * is reusing the component that already knows how to render everything.
 */
export const TrackMap = dynamic<TrackMapCanvasProps>(() => import('./TrackMapCanvas'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-card" />,
});
