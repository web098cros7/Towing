'use client';

import { Badge } from '@towing/web-ui';
import { useRealtime } from '../RealtimeProvider';
import { REALTIME_MODE_LABEL, type RealtimeMode } from '../types';

/**
 * §11.6: the console never pretends. An operator looking at a still map must be
 * able to tell "nothing is moving" from "we lost the connection".
 */
const variant: Record<RealtimeMode, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  connecting: 'neutral',
  live: 'success',
  reconnecting: 'warning',
  polling: 'warning',
  offline: 'error',
  mock: 'info',
};

const title: Record<RealtimeMode, string> = {
  connecting: 'Opening the realtime connection',
  live: 'Positions stream within 2 seconds of a driver ping',
  reconnecting: 'Connection lost — retrying with backoff',
  polling: 'Realtime unavailable — refreshing over REST every 10 seconds',
  offline: 'Not receiving updates. Sign in again to resume.',
  mock: 'Demo data — no backend connected',
};

export function RealtimeStatusChip() {
  const { mode } = useRealtime();

  return (
    <Badge variant={variant[mode]} title={title[mode]} data-testid="realtime-status">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${mode === 'live' ? 'animate-pulse bg-success' : 'bg-current'}`}
      />
      {REALTIME_MODE_LABEL[mode]}
    </Badge>
  );
}
