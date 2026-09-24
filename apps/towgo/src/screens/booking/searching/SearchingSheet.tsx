import React from 'react';
import { View } from 'react-native';
import { MiButton, MiCard, MiInfoBanner, MiSheetPanel, MiSummaryRow, MiText } from '@/design';

/**
 * The bottom sheet of Figma 16 Searching for Tow (`372:18809`) and 17 No
 * Drivers Found (`372:18839`). Both frames draw the same container (padding
 * 14 / 21 / 34 / 21, gap 16, top radius 24, MiTow/Elevation/Sheet, flush with
 * the bottom of the screen) and the same stack: Handle, Heading, Info Banner,
 * Trip card, then the frame's own actions.
 *
 * Every static string below is the rendered Figma text, character for
 * character (straight apostrophes, U+00B7 middle dot). The layer NAMES in the
 * file are stale ("24/7 Roadside Assistance", "Cancel Booking", "Book a Tow"…)
 * and are never used as copy.
 */

/**
 * A search wave as the dispatch engine reports it (`useSearchProgress`).
 * `null` before the engine has run its first wave.
 */
export type SearchingSheetProgress = { radiusKm: number; driversContacted: number } | null;

/** Holds a text line's height without drawing a character. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * The radius as a person reads it: whole kilometres stay whole ("5"), anything
 * else is rounded to one decimal ("2.5"), never a raw float ("3.3333333").
 */
function formatRadiusKm(radiusKm: number): string {
  return String(Math.round(radiusKm * 10) / 10);
}

/**
 * 16's banner subtitle. The static parts are the Figma text verbatim ("drivers"
 * is the only form the design draws). Before the first wave there is no radius
 * and no count to put in it, and the design draws no copy for that moment, so
 * the line keeps its height (a no-break space) instead of showing invented
 * numbers; the real values fill it the moment the engine reports.
 */
function searchSubtitle(progress: SearchingSheetProgress): string {
  if (!progress) return NO_BREAK_SPACE;
  const drivers = progress.driversContacted === 1 ? 'driver' : 'drivers';
  return `Searching within ${formatRadiusKm(progress.radiusKm)} km · ${progress.driversContacted} ${drivers} contacted`;
}

export type SearchingSheetProps = {
  /** `searching` draws frame 16, `noDrivers` draws frame 17. */
  state: 'searching' | 'noDrivers';
  /** 16's banner: "Searching within {radiusKm} km · {driversContacted} drivers contacted". */
  progress: SearchingSheetProgress;
  /** Summary Row values, DYNAMIC (example "MG Road, Bengaluru" / "Indiranagar, Bengaluru"). */
  pickup: string;
  drop: string;
  onCancelRequest: () => void;
  onGetHelp: () => void;
  onTryAgain: () => void;
};

export function SearchingSheet({
  state,
  progress,
  pickup,
  drop,
  onCancelRequest,
  onGetHelp,
  onTryAgain,
}: SearchingSheetProps) {
  const noDrivers = state === 'noDrivers';

  return (
    <MiSheetPanel>
      {/* Heading 291:2410 / 291:2476: vertical, gap 6, centred. */}
      <View style={{ gap: 6 }}>
        <MiText variant="display27" align="center">
          {noDrivers ? 'No drivers found' : 'Searching for Tow'}
        </MiText>
        <MiText variant="bodyL155" color="secondary" align="center">
          {noDrivers
            ? "We couldn't find a driver nearby right now."
            : "We're finding the best driver for you."}
        </MiText>
      </View>

      {/* Info Banner 224:14, fixed 67 tall, Show chevron = false on both frames. */}
      {noDrivers ? (
        <MiInfoBanner
          icon="alert"
          tone="muted"
          title="No drivers available"
          subtitle="Please try again in a moment."
        />
      ) : (
        <MiInfoBanner
          icon="hourglass"
          tone="brand"
          title="Hang tight!"
          subtitle={searchSubtitle(progress)}
        />
      )}

      {/* Trip card 291:2424 / 291:2490: padding 12 / 14 / 14 inside a 1.2 border, gap 10. */}
      <MiCard paddingTop={12} paddingBottom={14} paddingHorizontal={14} gap={10}>
        <MiSummaryRow label="Pickup" value={pickup} />
        <MiSummaryRow label="Drop" value={drop} />
      </MiCard>

      {noDrivers ? (
        /* Actions 372:18859: row, gap 12, items start, both buttons fill. */
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <MiButton
            tone="secondarySubtle"
            label="Get Help"
            onPress={onGetHelp}
            style={{ flex: 1 }}
          />
          <MiButton tone="primary" label="Try Again" onPress={onTryAgain} style={{ flex: 1 }} />
        </View>
      ) : (
        /* Cancel Request 291:2455: Secondary Button Tone=Strong, full width. */
        <MiButton tone="secondaryStrong" label="Cancel Request" onPress={onCancelRequest} />
      )}
    </MiSheetPanel>
  );
}
