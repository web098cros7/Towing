import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { JobStatus } from '@towing/api-contracts';
import {
  MiButton,
  MiChip,
  MiColorIcon,
  MiSheet,
  MiStatusBadge,
  MiText,
  mitowColors,
  mitowRadii,
} from '@/design';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import { firstNameOf } from '@/screens/booking/tracking/trackingDisplay';
import { formatEta, formatPaise } from '@/utils/format';
import { useCancellationQuote } from '../api/tracking.queries';

/**
 * Figma 21 · Cancel Trip (`291:2309`): a modal bottom sheet `291:2561` over 20
 * Booking Details, which opens it from "Cancel Booking". §9.1.7's "cancel button
 * (policy-aware, shows fee before confirming)".
 *
 * `MiSheet` with its defaults, which are exactly the drawn sheet: Dim 45 %
 * surface/inverse, radius 24, Elevation/Sheet, padding 14 / 21 / 34 (plus the
 * safe area) / 21, gap 16, the 36 × 5 handle. Its height hugs the content and
 * nothing scrolls. Top to bottom: the alert icon circle, the heading, the fee row,
 * the reason chips and the two actions.
 *
 * THE FEE IS FETCHED WHEN THE SHEET OPENS, never with the screen. §3.5's tiers
 * move with the clock (0–2 minutes free, 2–10 partial, beyond that full), so a
 * quote fetched on mount and shown five minutes later would name the wrong tier
 * at exactly the moment the customer commits to it. `useCancellationQuote` is
 * `enabled`-gated on this sheet's visibility and `gcTime: 0`.
 *
 * Also used by the tracking screen's pre-redesign sheet, which passes none of the
 * optional props: the body then falls back to the server's own explanation.
 */

/** Heading title `291:2567`, VERBATIM. */
const TITLE = 'Cancel this trip?';

/** Chips `291:2576`–`291:2584`: Label#281:112 VERBATIM, in drawn order. */
const REASONS = [
  'Changed my plans',
  'Driver is too far',
  'Booked by mistake',
  'Found help nearby',
  'Other',
] as const;
type Reason = (typeof REASONS)[number];

/** Figma box of the body's second line "about 5 mins." (Body L 15.5), for its placeholder. */
const BODY_LAST_LINE_WIDTH = 95;
/** Badge "No fee" `291:2571`: 61 × 28, radius 8. */
const BADGE_WIDTH = 61;
const BADGE_HEIGHT = 28;

const noop = () => {};

/**
 * Body `291:2568`, DYNAMIC: "{first name} is already on the way and will reach
 * you in about {minutes} mins." Composed only where it is true, i.e. while the
 * driver is assigned or on the way and both the name and the ETA are known. The
 * first name is the name's first word (`firstNameOf`, the rule 24 uses too). The
 * minutes are the same count as 20's status card (and 18's heading), so they
 * always agree. Anywhere else the body is the server quote's own `reason`.
 */
function drawnBody(
  status: JobStatus | undefined,
  driverName: string | null | undefined,
  etaMinutes: number | null | undefined,
): string | null {
  if (status !== 'assigned' && status !== 'en_route') return null;
  const firstName = firstNameOf(driverName);
  if (!firstName || etaMinutes === null || etaMinutes === undefined) return null;
  return `${firstName} is already on the way and will reach you in about ${formatEta(etaMinutes)}.`;
}

export function CancelTripSheet({
  bookingId,
  visible,
  onDismiss,
  onConfirm,
  isCancelling,
  driverName,
  etaMinutes,
  status,
}: {
  bookingId: string;
  visible: boolean;
  /** "Keep My Trip" and Android back. */
  onDismiss: () => void;
  /**
   * "Yes, Cancel Trip". Called with the selected chip's label VERBATIM (the API
   * takes one optional free-text `reason`), or `undefined` when no chip is selected.
   */
  onConfirm: (reason?: string) => void;
  isCancelling: boolean;
  /** The tracked driver's full name ("Rakesh Kumar"); the body uses the first word. */
  driverName?: string | null;
  /** Minutes to the driver's arrival, shared with the screen's own ETA. */
  etaMinutes?: number | null;
  /** The booking's live status; the drawn sentence is only true while assigned or en route. */
  status?: JobStatus;
}) {
  const { data: quote } = useCancellationQuote(bookingId, visible);

  // Single-select and optional: nothing is preselected when the sheet opens, a tap
  // selects one chip (deselecting any other), and a tap on the selected chip clears it.
  // The reset happens while RENDERING the open, not in an effect after it (which
  // would paint the previous choice first) and not on close (iOS keeps drawing
  // the sheet through its fade-out, so the chip would visibly clear).
  const [reason, setReason] = useState<Reason | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setReason(null);
  }
  const toggle = useCallback(
    (next: Reason) => setReason((current) => (current === next ? null : next)),
    [],
  );

  const body = drawnBody(status, driverName, etaMinutes) ?? quote?.reason ?? null;

  // "No fee" is drawn for a free cancellation. A chargeable one shows its amount in
  // the same badge (not drawn; flagged in DATA-GAPS-20-21.md).
  const free = quote ? quote.tier === 'free' || quote.feePaise === 0 : false;
  const feeLabel = quote ? (free ? 'No fee' : formatPaise(quote.feePaise)) : null;
  // The contract's "we cannot take this fee" branch: the server would refuse the cancel.
  const blocked = quote !== undefined && !free && !quote.chargeable;

  // Once "Yes, Cancel Trip" is in flight the cancel cannot be taken back, so
  // Keep My Trip and Android back do nothing until it settles (no disabled look
  // is drawn; the spinner on the confirm button is the only change).
  const dismiss = isCancelling ? noop : onDismiss;

  return (
    <MiSheet visible={visible} onClose={dismiss} accessibilityLabel={TITLE}>
      {/* Icon `291:2564`: 64 circle, status/danger-soft, icon/color/alert 36 centred. */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.dangerSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MiColorIcon name="alert" size={36} />
      </View>

      {/* Heading `291:2566`: gap 6. Title 23, then Body L 15.5 secondary (wraps to 2 lines). */}
      <View style={{ gap: 6 }}>
        <MiText variant="title23" numberOfLines={1} ellipsizeMode="clip" accessibilityRole="header">
          {TITLE}
        </MiText>
        {body !== null ? (
          <MiText variant="bodyL155" color="secondary">
            {body}
          </MiText>
        ) : (
          <View>
            <SlotPlaceholder variant="bodyL155" width={351} />
            <SlotPlaceholder variant="bodyL155" width={BODY_LAST_LINE_WIDTH} />
          </View>
        )}
      </View>

      {/* Cancellation fee `291:2569`: surface/muted, radius 14, padding 14 / 14 / 14 / 16. */}
      <View
        accessible
        accessibilityLabel={feeLabel ? `Cancellation fee, ${feeLabel}` : 'Cancellation fee'}
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 14,
          paddingRight: 14,
          paddingBottom: 14,
          paddingLeft: 16,
          borderRadius: mitowRadii.cardSm,
          backgroundColor: mitowColors.surfaceMuted,
        }}
      >
        <MiText variant="bodyM15" numberOfLines={1}>
          Cancellation fee
        </MiText>
        {feeLabel !== null ? (
          <MiStatusBadge status="completed" label={feeLabel} />
        ) : (
          // The quote has not arrived (or failed): an EMPTY slot of the badge's drawn
          // size, so the row stays 56 tall. 21 draws no skeleton, so nothing fills it.
          <View style={{ width: BADGE_WIDTH, height: BADGE_HEIGHT }} />
        )}
      </View>

      {/* Reason `291:2573`: gap 10. Strong 14 label, then the wrapping chip row (gap 8 both ways). */}
      <View style={{ gap: 10 }}>
        <MiText variant="strong14">Tell us why (optional)</MiText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {REASONS.map((label) => (
            <MiChip
              key={label}
              label={label}
              selected={reason === label}
              onPress={() => toggle(label)}
            />
          ))}
        </View>
      </View>

      {/* Actions `291:2586`: gap 10, the destructive action on top. */}
      <View style={{ gap: 10 }}>
        <MiButton
          tone="dangerSoft"
          label="Yes, Cancel Trip"
          onPress={() => onConfirm(reason ?? undefined)}
          loading={isCancelling}
          disabled={blocked}
        />
        <MiButton tone="secondarySubtle" label="Keep My Trip" onPress={dismiss} />
      </View>
    </MiSheet>
  );
}
