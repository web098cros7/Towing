import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { mitowColors } from '../tokens/colors';
import { MiText } from './MiText';

/**
 * Figma Timeline Row set `234:293` → `state`:
 * - `done`     State=Done `234:260`
 * - `current`  State=Current `234:271`
 * - `upcoming` State=Upcoming `234:283`
 * - `pickup`   State=Pickup `243:804`
 * - `drop`     State=Drop `243:815`
 */
export type MiTimelineRowState = 'done' | 'current' | 'upcoming' | 'pickup' | 'drop';

export type MiTimelineRowProps = {
  state: MiTimelineRowState;
  /** Title#234:2. MiTow/Strong 16, text/primary in EVERY state (upcoming titles are not greyed). */
  title: string;
  /**
   * Subtitle#234:6. Drawn only when non-empty (= "Show subtitle#238:23" true).
   * MiTow/Body S 14, text/secondary. Hidden on 19, 20 and 21.
   */
  subtitle?: string | null;
  /**
   * Time#234:10, MiTow/Body S 14 text/secondary, verbatim ("10:12 AM", "Est. 10:17 AM",
   * "---"). The component has no "Show time" property, so the slot is always drawn:
   * `null` holds it open with a surface/muted placeholder bar `timeSlotWidth` wide
   * (the first-read convention of 18).
   */
  time: string | null;
  /** Figma width of the Time text box, used only while `time` is null. Default 59 (19's "10:12 AM"). */
  timeSlotWidth?: number;
  /** Show connector#234:14. Default true. */
  showConnector?: boolean;
  /** The last row of a timeline: same as `showConnector={false}`. */
  last?: boolean;
  /**
   * The instance's FIXED height from the screen spec. The master is 67; instances override it:
   * 19 / 20 / 21: 40, last row 28 (no subtitle). 25: 67 / 48. 35: 58 / 42.
   * The connector fills the rest of the rail, so it is (height − 30.5) long.
   */
  height: number;
  /** Default: "{title}, {time}, {state} step". A time with no letters or digits ("---") is not read. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** A circle positioned inside the 26 × 26 dot box, as the variant's ellipses are drawn. */
type Circle = {
  d: number;
  at: number;
  fill: string;
  /** INSIDE stroke; an RN border is drawn inside the box, which matches exactly. */
  stroke?: { width: number; color: string };
};

/** Dot drawings of the five variants (ellipses inside the 26 dot frame, back to front). */
const DOTS: Record<MiTimelineRowState, Circle[]> = {
  done: [
    { d: 23, at: 1.5, fill: mitowColors.borderHandle },
    { d: 12, at: 7, fill: mitowColors.textPrimary },
  ],
  current: [
    { d: 26, at: 0, fill: mitowColors.brandYellow },
    { d: 17, at: 4.5, fill: mitowColors.surfacePage },
    { d: 10, at: 8, fill: mitowColors.brandYellow },
  ],
  upcoming: [
    {
      d: 17,
      at: 4.5,
      fill: mitowColors.surfacePage,
      stroke: { width: 2, color: mitowColors.textPlaceholder },
    },
  ],
  pickup: [
    { d: 23, at: 1.5, fill: mitowColors.successSoft },
    { d: 12, at: 7, fill: mitowColors.success },
  ],
  drop: [
    { d: 23, at: 1.5, fill: mitowColors.dangerSoft },
    { d: 12, at: 7, fill: mitowColors.danger },
  ],
};

/** The connector is brand/yellow under Current only; border/handle in every other state. */
function connectorColor(state: MiTimelineRowState): string {
  return state === 'current' ? mitowColors.brandYellow : mitowColors.borderHandle;
}

const STATE_WORD: Record<MiTimelineRowState, string> = {
  done: 'completed step',
  current: 'current step',
  upcoming: 'upcoming step',
  pickup: 'pickup',
  drop: 'drop',
};

const DOT = 26;

/** 18's SlotPlaceholder look, inlined so the design layer does not import from a screen. */
function TimePlaceholder({ width }: { width: number }) {
  return (
    <View style={{ width, maxWidth: '100%' }}>
      <MiText variant="bodyS14" numberOfLines={1}>
        {' '}
      </MiText>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '18%',
          bottom: '18%',
          borderRadius: 4,
          backgroundColor: mitowColors.surfaceMuted,
        }}
      />
    </View>
  );
}

/**
 * Timeline Row (`234:293`), identical geometry in all five variants:
 * - Row: horizontal, gap 7, items top-aligned, no padding, fixed `height`.
 * - Rail: 32 wide, full row height, vertical, padding-top 1.5, gap 3, items centred, clips.
 *   Dot 26 × 26 (clips); Connector 2 wide, radius 1, fills the rest.
 * - Text: flex 1, vertical, gap 2, clips. Title Strong 16; subtitle Body S 14 secondary.
 * - Time: hugs, padding-top 1.7, clips; Body S 14 secondary. Its right edge is the row's.
 *
 * Texts are single-line and clip (Figma: auto-width in a clipping frame; 18's convention).
 * Not pressable.
 */
export function MiTimelineRow({
  state,
  title,
  subtitle,
  time,
  timeSlotWidth = 59,
  showConnector = true,
  last = false,
  height,
  accessibilityLabel,
  style,
}: MiTimelineRowProps) {
  const connector = showConnector && !last;
  const readableTime = time && /[A-Za-z0-9]/.test(time) ? `, ${time}` : '';
  const label =
    accessibilityLabel ??
    `${title}${subtitle ? `, ${subtitle}` : ''}${readableTime}, ${STATE_WORD[state]}`;

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, height }, style]}
    >
      <View
        style={{
          width: 32,
          alignSelf: 'stretch',
          paddingTop: 1.5,
          gap: 3,
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        <View style={{ width: DOT, height: DOT, overflow: 'hidden' }}>
          {DOTS[state].map((c, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: c.at,
                top: c.at,
                width: c.d,
                height: c.d,
                borderRadius: c.d / 2,
                backgroundColor: c.fill,
                ...(c.stroke ? { borderWidth: c.stroke.width, borderColor: c.stroke.color } : null),
              }}
            />
          ))}
        </View>
        {connector ? (
          <View
            style={{ flex: 1, width: 2, borderRadius: 1, backgroundColor: connectorColor(state) }}
          />
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 2, overflow: 'hidden' }}>
        <MiText variant="strong16" numberOfLines={1} ellipsizeMode="clip">
          {title}
        </MiText>
        {subtitle ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
            {subtitle}
          </MiText>
        ) : null}
      </View>

      <View style={{ paddingTop: 1.7, overflow: 'hidden' }}>
        {time !== null ? (
          <MiText variant="bodyS14" color="secondary" numberOfLines={1} ellipsizeMode="clip">
            {time}
          </MiText>
        ) : (
          <TimePlaceholder width={timeSlotWidth} />
        )}
      </View>
    </View>
  );
}
