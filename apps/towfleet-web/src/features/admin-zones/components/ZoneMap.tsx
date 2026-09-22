'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@towing/web-ui';
import type { ZoneMapCanvasProps } from './ZoneMapCanvas';

/**
 * The SSR seam, exactly like the admin live map: MapLibre touches `window` at
 * import time (and Terra Draw registers DOM listeners), so the canvas is
 * client-only and the loading state is a skeleton, never a flash of an empty
 * rectangle.
 */
export const ZoneMap = dynamic<ZoneMapCanvasProps>(() => import('./ZoneMapCanvas'), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-64 w-full" />,
});
