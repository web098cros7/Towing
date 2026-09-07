import { useEffect, useRef, useState } from 'react';
import {
  frameFor,
  isAnimating,
  retarget,
  type AnimatedFrame,
  type MotionTrack,
} from '@towing/api-contracts';

/**
 * §11.4's "the marker animates from previous → new point over ~1s with easing;
 * heading rotates the truck icon to match bearing", for ONE driver.
 *
 * THE MATHS IS SHARED WITH THE FLEET CONSOLE — `retarget`, `frameFor` and the
 * teleport threshold all come from `@towing/api-contracts`, which is also where
 * the console's `PositionAnimator` gets them. Two surfaces animating the same
 * fact with two different easings would be a difference nobody could explain.
 * What is local is the loop: the console drives a `requestAnimationFrame` over
 * a whole fleet; this drives one marker at a fixed interval.
 *
 * `setInterval`, NOT `requestAnimationFrame`, and that is a deliberate downgrade.
 * rAF exists in React Native but running it for the length of a tow, on a screen
 * that is already holding a map and a socket, spends battery §11.10 explicitly
 * budgets ("driver battery drain ≤ ~6–8 %/hour" is the driver's side, and a
 * customer watching a twenty-minute tow deserves the same care). 60 ms is ~17 fps,
 * which is smooth enough for a marker gliding a few pixels and a sixth of the
 * work.
 *
 * IT STOPS WHEN THE TWEEN DOES. `isAnimating` is what ends the interval, so a
 * stationary driver — which is most of an arrival — costs nothing at all.
 */

const FRAME_MS = 60;

export interface AnimatedPositionInput {
  lat: number;
  lng: number;
  headingDeg: number | null;
}

export function useAnimatedPosition(
  position: AnimatedPositionInput | null | undefined,
): AnimatedFrame | null {
  const track = useRef<MotionTrack | undefined>(undefined);
  const [frame, setFrame] = useState<AnimatedFrame | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!position) {
      track.current = undefined;
      setFrame(null);
      return;
    }

    const now = Date.now();
    const next = {
      lat: position.lat,
      lng: position.lng,
      // A null heading keeps the PREVIOUS one rather than snapping to north.
      // Losing a bearing for one ping is common on a slow-moving vehicle, and
      // spinning the glyph to 0° for it is worse than leaving it where it was.
      heading: position.headingDeg ?? track.current?.toHeading ?? 0,
    };

    const existing = track.current;
    // An identical position is not a new tween. Without this a stationary
    // driver's 3-second ping restarts the easing and the marker twitches.
    if (existing && existing.toLat === next.lat && existing.toLng === next.lng) {
      return;
    }

    track.current = retarget(existing, next, now);

    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      const at = Date.now();
      const current = track.current;
      if (!current) return;

      setFrame(frameFor(current, at));

      if (!isAnimating(current, at) && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, FRAME_MS);

    // Render the first frame synchronously so the marker appears immediately
    // rather than after one interval tick.
    setFrame(frameFor(track.current, now));

    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [position?.lat, position?.lng, position?.headingDeg, position]);

  return frame;
}
