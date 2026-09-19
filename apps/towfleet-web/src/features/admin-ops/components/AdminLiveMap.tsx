'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@towing/web-ui';
import type { AdminLiveMapCanvasProps } from './AdminLiveMapCanvas';

/**
 * The SSR seam for the admin map, exactly like the fleet `<FleetMap>`:
 * MapLibre touches `window` at import time, so the canvas is client-only and
 * the loading state is a skeleton, never a flash of an empty rectangle.
 */
export const AdminLiveMap = dynamic<AdminLiveMapCanvasProps>(
  () => import('./AdminLiveMapCanvas'),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);
