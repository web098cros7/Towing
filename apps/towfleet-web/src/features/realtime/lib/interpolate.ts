import {
  frameFor,
  isAnimating,
  retarget,
  type AnimatedFrame,
  type MotionTrack,
} from '@towing/api-contracts';
import type { FleetPosition } from '../types';

/**
 * §11.4: "the marker animates from previous → new point over ~1s with easing;
 * heading rotates to match bearing", and §11.10: "marker never teleports across
 * the screen for updates <= 10s apart".
 *
 * Pings land once a second in one batch, so without this every marker jumps.
 *
 * THE MATHS MOVED OUT IN PHASE 18. Easing, the shortest-arc heading, the teleport
 * threshold and the retarget-from-where-the-marker-actually-is rule now live in
 * `@towing/api-contracts` (`realtime/interpolation.ts`), because TowGo's tracking
 * screen needs exactly the same behaviour and cannot import a DOM component or a
 * react-native one. This class is what remains: the fleet-shaped collection
 * wrapper — many trucks, keyed by id, pruned when they leave the snapshot.
 *
 * The numbers and the behaviour are unchanged; `interpolation.ts` carries the
 * reasoning for each of them.
 */

export type { AnimatedFrame };

export class PositionAnimator {
  private tracks = new Map<string, MotionTrack>();

  /** Retargets each tween at the newest position; call on every data change. */
  update(positions: FleetPosition[], nowMs: number): void {
    const seen = new Set<string>();

    for (const position of positions) {
      if (position.lat === null || position.lng === null) continue;
      seen.add(position.truckId);

      const next = { lat: position.lat, lng: position.lng, heading: position.heading ?? 0 };
      const existing = this.tracks.get(position.truckId);

      // Nothing moved — leave the tween alone rather than restarting it, which
      // would make a stationary truck ease in place once a second.
      if (existing && existing.toLat === next.lat && existing.toLng === next.lng) continue;

      this.tracks.set(position.truckId, retarget(existing, next, nowMs));
    }

    // Drop trucks that left the snapshot so the map cannot animate a ghost.
    for (const truckId of this.tracks.keys()) {
      if (!seen.has(truckId)) this.tracks.delete(truckId);
    }
  }

  frames(nowMs: number): Map<string, AnimatedFrame> {
    const out = new Map<string, AnimatedFrame>();
    for (const [truckId, track] of this.tracks) out.set(truckId, frameFor(track, nowMs));
    return out;
  }

  /** True while any marker is still moving — lets the caller idle the rAF loop. */
  isAnimating(nowMs: number): boolean {
    for (const track of this.tracks.values()) {
      if (isAnimating(track, nowMs)) return true;
    }
    return false;
  }
}
