'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@towing/web-ui';
import type { FleetMapCanvasProps } from './FleetMapCanvas';

/**
 * The `<FleetMap>` seam. MapLibre touches `window` and WebGL at import time, so
 * it can never run during SSR — hence `ssr: false` here rather than a guard
 * inside the component.
 */
export const FleetMap = dynamic<FleetMapCanvasProps>(() => import('./FleetMapCanvas'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-card" />,
});
