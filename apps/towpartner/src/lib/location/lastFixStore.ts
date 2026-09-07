import { create } from 'zustand';

/**
 * The driver's most recent fix, exposed to React (Phase 18).
 *
 * NOTHING DID THIS BEFORE. Since Phase 16 the location task has written straight
 * into the MMKV ping buffer and out to the wire — which is exactly right for the
 * server's needs and leaves the app itself blind to where its own driver is.
 * §11.5's arrival assist ("within 100 m of pickup + speed < 5 km/h → prompts
 * driver 'Mark arrived?'") needs a live position on screen, so this is the seam.
 *
 * WRITTEN FROM `enqueue`, NOT FROM A SECOND WATCHER, and that is the whole
 * reason it is a store rather than a `watchPositionAsync` on the ActiveJob
 * screen. A second watcher would be a second GPS subscription running alongside
 * the background task — double the battery for the same data — and it would stop
 * the moment the screen unmounted or the app backgrounded, which is precisely
 * when a driver is most likely to be approaching a pickup with their phone in a
 * cradle and the screen off.
 *
 * NOT PERSISTED, deliberately. A stale fix rehydrated from disk at launch is
 * worse than no fix: the arrival assist would compare a pickup against wherever
 * the driver was yesterday. `driverStatusStore` makes the same call for the same
 * reason.
 *
 * §20.4 holds either way: this is only ever written while the location task is
 * running, and the task runs only while the driver is online or on a job.
 */

export interface LastFix {
  lat: number;
  lng: number;
  /** Metres, when the OS reported one. */
  accuracyM: number | null;
  /** km/h. Null when the OS reported no speed — which is not the same as zero. */
  speedKph: number | null;
  headingDeg: number | null;
  /** Epoch ms of the fix itself, not of the write. */
  atMs: number;
}

interface LastFixState {
  fix: LastFix | null;
  setFix: (fix: LastFix) => void;
  clear: () => void;
}

export const useLastFixStore = create<LastFixState>((set) => ({
  fix: null,
  setFix: (fix) => set({ fix }),
  clear: () => set({ fix: null }),
}));

/**
 * Called from the location task, outside React.
 *
 * A plain function rather than the hook, because `enqueue` runs inside a
 * `TaskManager` handler that has no component tree above it — zustand's
 * `setState` is available on the store object precisely for this.
 */
export function recordLastFix(fix: LastFix): void {
  useLastFixStore.getState().setFix(fix);
}

export function clearLastFix(): void {
  useLastFixStore.getState().clear();
}
