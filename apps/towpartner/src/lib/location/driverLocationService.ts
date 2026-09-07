import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { LOW_ACCURACY_METERS, PING_CADENCE, type DriverLocationPing } from '@towing/api-contracts';
import { presenceDataSource } from '@/features/presence/api/presenceDataSource';
import { clearLastFix, recordLastFix } from './lastFixStore';
import { bufferPing, clearBufferedUpTo, nextSeq, readBuffer } from './pingBuffer';

/**
 * §11.8's location capture — the Android foreground service, the iOS background
 * mode, and the flush that gets fixes to the server.
 *
 * CAPTURE HAPPENS ONLY WHILE ONLINE OR ON A JOB (§20.4). That is a privacy
 * commitment, not a battery optimisation, and it is why nothing here starts on
 * app launch: `start()` is called by going online and `stop()` by going offline,
 * and there is no third caller. The Play background-location review asks exactly
 * this question, and "we track drivers whenever the app is installed" is the
 * answer that fails it.
 *
 * A FOREGROUND SERVICE IS NOT OPTIONAL ON ANDROID. Since Android 10, background
 * location for a non-foreground app is throttled to a few updates an hour, and
 * since 12 a backgrounded app cannot start one at all. A tow that reports its
 * position four times an hour is not live tracking. The persistent notification
 * is the price, and Play policy requires it to be there anyway.
 *
 * ⚠ NONE OF THIS HAS RUN ON A DEVICE. `expo-location`'s background APIs need a
 * dev client, and no build has ever been produced for this app. The foreground
 * service, the Doze behaviour and the §11.10 6–8 %/h battery target are all
 * UNVERIFIED — see `tobedone.md`.
 */

/**
 * Registered at MODULE SCOPE, not inside a function.
 *
 * `TaskManager.defineTask` must run during the JS bundle's initial evaluation.
 * When Android relaunches a killed app to deliver a background location update,
 * it runs the bundle and immediately looks up the task by name — a definition
 * inside `start()` would not exist yet, and the update is dropped with a warning
 * nobody sees.
 */
export const LOCATION_TASK = 'towpartner-location-updates';

interface LocationTaskData {
  locations: Location.LocationObject[];
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as LocationTaskData;
  // Buffered FIRST and synchronously. Everything after this point can be killed
  // by the OS budget without losing a fix.
  for (const location of locations) enqueue(location);
  // Awaited so the OS keeps the process alive for the request rather than
  // suspending mid-flight — but `flush` never rejects, so a failure here leaves
  // the batch buffered for the next tick instead of failing the task.
  await flush();
});

/** Turns an OS fix into the wire shape, and queues it. */
function enqueue(location: Location.LocationObject): void {
  const ping: DriverLocationPing = {
    seq: nextSeq(),
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    at: new Date(location.timestamp).toISOString(),
    // Reported rather than filtered. §11.3 asks for a coarse fix to be FLAGGED,
    // not dropped: it is still the best position available, and the server
    // decides what to do with it. Dropping here would leave the marker frozen
    // wherever the last confident fix was.
    ...(location.coords.accuracy !== null && location.coords.accuracy !== undefined
      ? { accuracyM: location.coords.accuracy }
      : {}),
    ...(location.coords.heading !== null && location.coords.heading !== undefined && location.coords.heading >= 0
      ? { headingDeg: location.coords.heading }
      : {}),
    ...(location.coords.speed !== null && location.coords.speed !== undefined && location.coords.speed >= 0
      ? // expo reports m/s; the contract is km/h.
        { speedKph: location.coords.speed * 3.6 }
      : {}),
  };

  bufferPing(ping);

  /**
   * The app's own copy (Phase 18), for §11.5's arrival assist.
   *
   * HERE RATHER THAN IN A SECOND WATCHER: this handler already has the freshest
   * fix the OS will give us, and subscribing again from a screen would run two
   * GPS streams for one position — double the battery against §11.10's drain
   * budget — and would go blind the moment the screen unmounted, which is
   * exactly when a driver is approaching a pickup with the phone in a cradle.
   */
  recordLastFix({
    lat: ping.lat,
    lng: ping.lng,
    accuracyM: ping.accuracyM ?? null,
    speedKph: ping.speedKph ?? null,
    headingDeg: ping.headingDeg ?? null,
    atMs: location.timestamp,
  });
}

let flushing = false;

/**
 * Sends whatever is buffered, oldest first, and clears exactly what the server
 * confirmed.
 *
 * Guarded rather than queued: two overlapping flushes would send overlapping
 * batches, and the second's older half would be discarded as stale. A skipped
 * flush costs one cadence interval and nothing else, because the buffer is
 * durable.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  const pings = readBuffer();
  if (pings.length === 0) return;

  flushing = true;
  try {
    const result = await presenceDataSource.sendLocation({ pings });
    // Cleared against the SERVER's sequence, not against what we sent — a
    // partially-applied batch clears exactly the right prefix.
    clearBufferedUpTo(result.seq);
  } catch {
    // Left in the buffer for the next attempt. This is the tunnel case working
    // as designed, and it is the reason the buffer exists at all.
  } finally {
    flushing = false;
  }
}

export type PermissionOutcome = 'granted' | 'foreground-only' | 'denied';

/**
 * Asks for location permission.
 *
 * FOREGROUND FIRST, THEN BACKGROUND, ALWAYS IN THAT ORDER. Android refuses a
 * background request outright if foreground has not already been granted, and
 * iOS only offers "Always" as an upgrade from "While Using". Asking for
 * background cold is denied without a prompt ever appearing, which looks to the
 * driver like the button did nothing.
 *
 * A FOREGROUND-ONLY GRANT IS A USABLE STATE, not a failure. The driver can go
 * online and stream while the app is open; they lose capture when it is
 * backgrounded. Refusing to let them work at all over it would be worse for
 * them and for supply.
 */
export async function requestPermissions(): Promise<PermissionOutcome> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';

  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted ? 'granted' : 'foreground-only';
}

export async function hasForegroundPermission(): Promise<boolean> {
  const { granted } = await Location.getForegroundPermissionsAsync();
  return granted;
}

/**
 * Starts capture at `intervalMs` — the cadence the server pushed over
 * `config:update` or returned from go-online, never a local constant.
 *
 * Restarting an already-running task is how the cadence changes: expo has no
 * "update the interval" call, so the task is stopped and started with the new
 * options. That is cheap and is what makes the 10s idle → 3s on-job transition
 * possible without an app release.
 */
export async function start(intervalMs: number = PING_CADENCE.idleMs): Promise<void> {
  if (!(await hasForegroundPermission())) return;

  await stop();

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    // `Balanced` is ~100 m and would land most fixes on the wrong side of
    // `LOW_ACCURACY_METERS`; a tow marker needs to be on the right road.
    accuracy: Location.Accuracy.High,
    timeInterval: intervalMs,
    /**
     * Also emit after this much movement, whichever comes first. A driver
     * crawling in traffic produces near-identical fixes that the `seq` guard
     * accepts and the map cannot distinguish; a driver at highway speed covers
     * 250 m between two 10-second ticks. This makes the stream track DISTANCE
     * rather than only time.
     */
    distanceInterval: 25,
    // Batching would hold fixes on the device to save radio — exactly wrong for
    // live tracking, where the point is that the customer sees the marker now.
    deferredUpdatesInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    ...(Platform.OS === 'android'
      ? {
          foregroundService: {
            // Play policy requires a persistent, honest notification whenever a
            // backgrounded app collects location. It also gives the driver a
            // one-glance answer to "is this thing tracking me right now".
            notificationTitle: "You're online — MiTow Partner",
            notificationBody: 'Sharing your location so we can send you nearby jobs.',
            notificationColor: '#0F62FE',
            killServiceOnDestroy: false,
          },
        }
      : {}),
  });
}

/**
 * Stops capture and flushes what is left.
 *
 * The flush is the reason this is async. Up to a full cadence interval of the
 * shift's last movement lives only in the buffer, and §11.2 asks for final
 * positions to be persisted — the server's own go-offline flush covers its
 * in-memory half, but it cannot know about fixes the handset never sent.
 */
export async function stop(): Promise<void> {
  const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK).catch(() => false);
  if (running) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
  await flush();
  // Capture has stopped, so the last fix is now only getting older. Holding it
  // would let the arrival assist compare a pickup against a position from the
  // end of the previous shift.
  clearLastFix();
}

/** One immediate fix, for the go-online call — which cannot resolve a zone without one. */
export async function currentFix(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    return null;
  }
}

/** Exported for the UI's honesty states — a fix this coarse renders as a halo. */
export const LOW_ACCURACY_M = LOW_ACCURACY_METERS;
