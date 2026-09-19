import { frameFor, isAnimating, retarget, type AnimatedFrame, type MotionTrack } from '@towing/api-contracts';
import type { AdminLiveDriver } from '@towing/api-contracts';

/**
 * The fleet `PositionAnimator`'s maths (which lives in `@towing/api-contracts`),
 * keyed by driver instead of truck.
 *
 * A sibling rather than a reuse: the fleet class is typed to `FleetPosition`
 * and its snapshot semantics (prune on absence) belong to the fleet map. The
 * per-id wrapper is thirty lines; parameterising the fleet class would have
 * meant touching a console surface W4 has no business changing.
 */
export class DriverPositionAnimator {
  private tracks = new Map<string, MotionTrack>();

  update(drivers: AdminLiveDriver[], nowMs: number): void {
    const seen = new Set<string>();

    for (const driver of drivers) {
      if (driver.lat === null || driver.lng === null) continue;
      seen.add(driver.driverId);

      const next = { lat: driver.lat, lng: driver.lng, heading: driver.headingDeg ?? 0 };
      const existing = this.tracks.get(driver.driverId);
      if (existing && existing.toLat === next.lat && existing.toLng === next.lng) continue;

      this.tracks.set(driver.driverId, retarget(existing, next, nowMs));
    }

    // A driver who left the snapshot stops being animated — no ghosts.
    for (const driverId of this.tracks.keys()) {
      if (!seen.has(driverId)) this.tracks.delete(driverId);
    }
  }

  frames(nowMs: number): Map<string, AnimatedFrame> {
    const out = new Map<string, AnimatedFrame>();
    for (const [driverId, track] of this.tracks) out.set(driverId, frameFor(track, nowMs));
    return out;
  }

  isAnimating(nowMs: number): boolean {
    for (const track of this.tracks.values()) {
      if (isAnimating(track, nowMs)) return true;
    }
    return false;
  }
}
