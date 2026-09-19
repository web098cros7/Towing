import React from 'react';
import { Image, View, useWindowDimensions } from 'react-native';
import { Text } from '@towing/ui';

/**
 * TWO LAYERS, NOT ONE — this is the whole point of the Figma revision.
 *
 * The old `tow-truck-hero.png` was a single composite (489×316) with the
 * skyline baked into the truck artwork, which is why it could only ever be
 * placed as one flat block. The design separates them: a transparent truck over
 * a grey skyline held at 52% opacity and offset 20px right / 10px down, so the
 * city reads as depth behind the truck rather than as part of it.
 *
 * The composite is still used by the driver app's `OnlineStatusCard`, so it
 * stays in the tree — it is not dead.
 */
const truckImage = require('@/assets/illustrations/hero-truck.png');
const skylineImage = require('@/assets/illustrations/hero-skyline.png');

/**
 * EVERY CONSTANT BELOW IS IN DESIGN UNITS — the 390pt-wide Figma frame
 * (node `149:54`) — and is multiplied by `scale` at render.
 *
 * The first shipped version used these numbers as absolute dp, and on the first
 * real device (360dp wide) the truck slid 30dp left into the heading: the
 * comma of "Towing," touched the cab and "Anytime" ran under the wheels. A
 * fixed-size collage only reproduces the design at exactly 390dp; every other
 * width shows a different composition. Scaling the whole frame by
 * `width / 390` shows the SAME picture everywhere, which is what the design
 * actually specifies.
 */
const DESIGN_WIDTH = 390;
const HERO_HEIGHT = 181;

/**
 * Both layers are the same 325×158 box (art is 1536×747, ratio 2.056 ≈
 * 325/158, so `contain` neither crops nor letterboxes).
 */
const ART_WIDTH = 325;
const ART_HEIGHT = 158;

/**
 * ANCHORED RIGHT, NOT LEFT. Figma places the boxes at `left: 115` / `135`,
 * which puts their right edges 50 and 70 past the 390 frame. Anchoring right
 * keeps that bleed pinned to the screen edge, so if `scale` is ever clamped
 * (see below) the truck still meets the right edge instead of opening a gap.
 */
const TRUCK_RIGHT = -50;
const SKYLINE_RIGHT = -70;

/**
 * ⚠ THE +19.07 SHIFT IS DELIBERATE; NEITHER TOP IS A TYPO.
 *
 * `get_metadata` reports the frame as 390 × **161.44**, with the truck at
 * `y: -19.07` and the skyline at `y: -9.07` — both bleed ABOVE the frame's own
 * top edge. Figma's export is 390 × **181** because it renders that overflow,
 * and the export is what we reproduce: a 161-tall box with the truck
 * overflowing upward would clip the crane (RN clips overflow on Android) or
 * paint it over `AppHeader`. So each frame-space y gains 19.07:
 *
 *     truck    -19.07 + 19.07 =  0
 *     skyline   -9.07 + 19.07 = 10
 *
 * Verified by recomposing the hero from the two source PNGs and diffing
 * against the export: mean error 4.85 at these values, 7.50 at the naive
 * frame-space read, 7.11 with no skyline drawn at all — the naive read was
 * literally worse than omitting the layer.
 */
const TRUCK_TOP = 0;
const SKYLINE_TOP = 10;

/**
 * WIDTH IS WHAT PRODUCES THE THREE LINES. The string carries one hard break
 * ("Fast Towing," / "Anytime"); the first line then wraps against this 177
 * column to give the design's "Fast" / "Towing," / "Anytime".
 *
 * ⚠ DO NOT hard-code the three lines into the string instead. Four Maestro
 * flows assert `"Fast Towing,"` as their marker that Home has mounted, and
 * splitting it across explicit newlines breaks every one of them.
 */
const HEADING_WIDTH = 177;
const HEADING_LEFT = 22;

/**
 * Design type for this hero: 34.465 / 36.188 / -0.8616. Deliberately NOT the
 * shared `display` token (40/48/-1) — that token is used elsewhere at 40 and
 * must stay 40. Colour is also deliberately not set: #111827 is already
 * `textPrimary` in the light theme, and the default inverts correctly in dark
 * mode where a literal hex would render black-on-black.
 */
const FONT_SIZE = 34.5;
const LINE_HEIGHT = 36.2;
const LETTER_SPACING = -0.86;

export function HomeHero() {
  const { width } = useWindowDimensions();

  /**
   * Uniform scale of the whole 390-unit frame. Clamped so a tablet shows a
   * comfortably larger hero, not a billboard — beyond the clamp the artwork
   * stays pinned right (see TRUCK_RIGHT) and the extra width becomes breathing
   * room between heading and truck, which degrades gracefully.
   */
  const scale = Math.min(width / DESIGN_WIDTH, 1.15);
  const s = (v: number) => v * scale;

  return (
    <View
      style={{
        // `minHeight`, not `height`: at large accessibility font sizes the
        // heading has somewhere to grow instead of being clipped by the
        // `overflow: 'hidden'` that the artwork bleed needs.
        minHeight: s(HERO_HEIGHT),
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Behind the truck, and drawn first so it stays there. */}
      <Image
        source={skylineImage}
        resizeMode="contain"
        style={{
          position: 'absolute',
          right: s(SKYLINE_RIGHT),
          top: s(SKYLINE_TOP),
          width: s(ART_WIDTH),
          height: s(ART_HEIGHT),
          opacity: 0.52,
        }}
        accessibilityIgnoresInvertColors
        // Decorative: the skyline carries no information the heading doesn't.
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Image
        source={truckImage}
        resizeMode="contain"
        style={{
          position: 'absolute',
          right: s(TRUCK_RIGHT),
          top: s(TRUCK_TOP),
          width: s(ART_WIDTH),
          height: s(ART_HEIGHT),
        }}
        accessibilityIgnoresInvertColors
        accessibilityLabel="Tow truck loading a car"
      />
      <Text
        variant="display"
        weight="bold"
        style={{
          marginLeft: s(HEADING_LEFT),
          width: s(HEADING_WIDTH),
          fontSize: s(FONT_SIZE),
          lineHeight: s(LINE_HEIGHT),
          letterSpacing: s(LETTER_SPACING),
        }}
      >
        Fast Towing,{'\n'}Anytime
      </Text>
    </View>
  );
}
