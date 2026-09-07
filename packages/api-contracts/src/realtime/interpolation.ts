/**
 * §11.4's marker motion, as pure arithmetic.
 *
 * WHY IT LIVES IN THE CONTRACTS PACKAGE AND NOT IN A UI ONE. Three surfaces
 * animate a moving vehicle — the fleet console (MapLibre, since Phase 5), TowGo's
 * tracking screen and TowPartner's job map (both `react-native-maps`, Phase 18) —
 * and they cannot share a component: one is DOM, two are native. What they CAN
 * share is the maths, and this is the same argument `presence.ts` won for the
 * §11.6 thresholds. `packages/ui` would drag react-native into the Next bundle;
 * this package already has a web-safe `import` condition and is imported by all
 * three.
 *
 * §11.10's acceptance criteria are what these numbers exist to satisfy:
 * "marker never teleports across the screen for updates ≤ 10s apart", and
 * motion that is smooth rather than a jump per ping.
 */

/**
 * Tween duration. Matches the 1 s server flush cadence so a tween finishes just
 * as the next batch lands — any longer and the marker is permanently behind;
 * any shorter and it arrives early and sits still, which reads as stuttering.
 */
export const TWEEN_MS = 1_000;

/**
 * Beyond this the jump is REAL — a resync, a first GPS fix after a tunnel, a
 * driver reassigned — and gliding across it would draw a vehicle travelling
 * 25 km in one second. Snap instead.
 *
 * 0.25° is roughly 28 km, comfortably beyond anything a vehicle covers in the
 * ten seconds §11.10 bounds and comfortably inside a genuine relocation.
 */
export const TELEPORT_DEG = 0.25;

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Shortest way round the compass: 350° → 10° is +20°, not −340°.
 *
 * Without this a truck turning north through zero spins almost all the way
 * round the dial, which is the single most noticeable animation bug on a map.
 */
export function shortestArc(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/** One tween in flight. */
export interface MotionTrack {
  fromLat: number;
  fromLng: number;
  fromHeading: number;
  toLat: number;
  toLng: number;
  toHeading: number;
  startedAt: number;
}

export interface AnimatedFrame {
  lat: number;
  lng: number;
  heading: number;
}

/** Where a track is right now. */
export function frameFor(track: MotionTrack, nowMs: number): AnimatedFrame {
  const progress = Math.min(1, Math.max(0, (nowMs - track.startedAt) / TWEEN_MS));
  const eased = easeOutCubic(progress);
  return {
    lat: track.fromLat + (track.toLat - track.fromLat) * eased,
    lng: track.fromLng + (track.toLng - track.fromLng) * eased,
    heading: track.fromHeading + shortestArc(track.fromHeading, track.toHeading) * eased,
  };
}

/**
 * Retarget a track at a new position, preserving smoothness.
 *
 * THE NEW TWEEN STARTS WHERE THE MARKER ACTUALLY IS, not at the previous target.
 * A batch arriving mid-tween would otherwise snap the marker back to where the
 * last one was aiming and then set off again — a visible stutter on every single
 * update, and the bug this function exists to make impossible to reintroduce.
 *
 * Pass `undefined` for `existing` to seed a track that is already settled.
 */
export function retarget(
  existing: MotionTrack | undefined,
  next: { lat: number; lng: number; heading: number },
  nowMs: number,
): MotionTrack {
  if (!existing) {
    return {
      fromLat: next.lat,
      fromLng: next.lng,
      fromHeading: next.heading,
      toLat: next.lat,
      toLng: next.lng,
      toHeading: next.heading,
      // Already finished, so a freshly seeded marker renders at its position
      // rather than easing in from itself.
      startedAt: nowMs - TWEEN_MS,
    };
  }

  const jumped =
    Math.abs(next.lat - existing.toLat) > TELEPORT_DEG ||
    Math.abs(next.lng - existing.toLng) > TELEPORT_DEG;

  const current = jumped ? next : frameFor(existing, nowMs);

  return {
    fromLat: current.lat,
    fromLng: current.lng,
    fromHeading: current.heading,
    toLat: next.lat,
    toLng: next.lng,
    toHeading: next.heading,
    startedAt: nowMs,
  };
}

/** True while the track is still moving — lets a caller idle its animation loop. */
export function isAnimating(track: MotionTrack, nowMs: number): boolean {
  return nowMs - track.startedAt < TWEEN_MS;
}
