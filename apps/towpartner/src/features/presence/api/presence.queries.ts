import { useCallback, useState } from 'react';
import type { DriverConfigUpdateEvent } from '@towing/api-contracts';
import { track } from '@/lib/analytics/analytics';
import * as locationService from '@/lib/location/driverLocationService';
import { resetSeq } from '@/lib/location/pingBuffer';
import { connectDriverSocket, disconnectDriverSocket } from '@/lib/realtime/driverSocket';
import {
  applyChatMessage,
  applyJobOffer,
  applyJobRevoked,
} from '@/features/offers/realtime/offerFrames';
import { storage } from '@/lib/storage/storage';
import { useDriverStatusStore } from '@/features/dashboard/store/driverStatusStore';
import { presenceDataSource } from './presenceDataSource';

/**
 * The online toggle, wired to the real backend (Phase 16).
 *
 * NOT a `useMutation`. Going online is not one request — it is a permission
 * prompt, an OS location fix, a server call, a background task start and a
 * socket connect, in that order, each of which can fail differently and needs a
 * different message. TanStack's single `error` slot would flatten "you did not
 * grant location" and "an admin suspended you" into the same red text.
 */

/** Set once the driver has been online at least once. §22.1's `driver_first_online`. */
const FIRST_ONLINE_KEY = 'presence.hasBeenOnline';

export type GoOnlineFailure =
  | { kind: 'permission-denied' }
  | { kind: 'no-fix' }
  | { kind: 'outside-zone'; message: string }
  | { kind: 'not-approved' }
  | { kind: 'failed'; message: string };

interface ApiErrorish {
  status?: number;
  code?: string;
  message?: string;
}

export function usePresence() {
  const setOnline = useDriverStatusStore((s) => s.setOnline);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GoOnlineFailure | null>(null);
  const [zoneName, setZoneName] = useState<string | null>(null);

  const applyConfig = useCallback((config: DriverConfigUpdateEvent) => {
    // The cadence is the SERVER's to decide (§16.6), so battery and fidelity can
    // be retuned without an app release. `null` means stop capturing entirely
    // (§20.4) rather than capture rarely.
    if (config.pingIntervalMs === null) {
      void locationService.stop();
      return;
    }
    void locationService.start(config.pingIntervalMs);
  }, []);

  const goOnline = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      const permission = await locationService.requestPermissions();
      if (permission === 'denied') {
        setFailure({ kind: 'permission-denied' });
        return false;
      }

      // The server cannot resolve a zone without a coordinate, and a driver in
      // no zone is in no GEO set — online in their own UI and invisible to every
      // search. Getting the fix BEFORE the call is what makes that impossible.
      const fix = await locationService.currentFix();
      if (!fix) {
        setFailure({ kind: 'no-fix' });
        return false;
      }

      const presence = await presenceDataSource.goOnline({
        at: { lat: fix.coords.latitude, lng: fix.coords.longitude },
        ...(fix.coords.accuracy !== null && fix.coords.accuracy !== undefined
          ? { accuracyM: fix.coords.accuracy }
          : {}),
      });

      // Server-side the hash carries no `seq` after go-online, so it accepts
      // whatever the first ping brings — resetting here keeps the two counters
      // starting from the same place rather than relying on that leniency.
      resetSeq(presence.seq);
      setZoneName(presence.zoneName);
      setOnline(true);

      if (presence.pingIntervalMs !== null) {
        await locationService.start(presence.pingIntervalMs);
      }
      // After the location task, not before: the socket is the fast path and an
      // optional one, and a slow handshake must not delay capture starting.
      void connectDriverSocket({
        onConfigUpdate: applyConfig,
        // §6.3's frames go straight to the query cache, which is what the
        // takeover gate watches — see `offerFrames.ts` for why these are module
        // functions and not callbacks closed over this render.
        onJobOffer: applyJobOffer,
        onJobRevoked: applyJobRevoked,
        // Trip chat, same reasoning: the merge is a cache write, not a UI
        // callback, so it survives this component unmounting.
        onChatMessage: applyChatMessage,
      });

      if (!storage.getString(FIRST_ONLINE_KEY)) {
        storage.set(FIRST_ONLINE_KEY, '1');
        // §22.1. Emitted once per install, at the moment supply is actually
        // created — the input to every activation-rate number for the launch
        // cohort, and not recoverable after the fact.
        track('driver_first_online');
      }
      track('driver_online');
      return true;
    } catch (error) {
      const api = error as ApiErrorish;
      if (api.code === 'driver_outside_zone') {
        setFailure({
          kind: 'outside-zone',
          message: api.message ?? 'You are outside every service area we operate in',
        });
      } else if (api.status === 403) {
        setFailure({ kind: 'not-approved' });
      } else {
        setFailure({ kind: 'failed', message: api.message ?? 'Could not go online' });
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyConfig, setOnline]);

  const goOffline = useCallback(async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    // CAPTURE STOPS FIRST, before the server call, and it flushes on the way
    // out. §20.4 is a promise about the handset — if the request fails, the
    // driver has still stopped being tracked, which is the direction that must
    // not depend on the network.
    await locationService.stop();
    disconnectDriverSocket();
    setOnline(false);
    setZoneName(null);

    try {
      await presenceDataSource.goOffline();
    } catch {
      // The server evicts them on its own within a stale window regardless, and
      // an error toast for a driver who has already stopped sharing their
      // location would be alarming and pointless.
    } finally {
      setBusy(false);
    }
  }, [setOnline]);

  return { goOnline, goOffline, busy, failure, zoneName, clearFailure: () => setFailure(null) };
}
