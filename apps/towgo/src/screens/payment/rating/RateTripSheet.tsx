import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { MiButton, MiSheet, MiText, mitowColors, mitowRadii } from '@/design';
import { useRatingState, useSubmitRating } from '@/features/payments/api/payments.queries';
import {
  firstNameOf,
  vehicleModelLabel,
  vehiclePlateLabel,
  type TrackedDriverDisplay,
} from '@/screens/booking/tracking/trackingDisplay';
import { ReviewInput } from './ReviewInput';
import { StarRow } from './StarRow';

/**
 * Figma 31 · Rate Your Trip (`234:398`): a modal bottom sheet over 30 · Payment Successful, which
 * is the screen behind it. NOT a screen of its own — there is no route, and 30 stays mounted and
 * visible under the dim, so its three controls are exactly where they were once the sheet closes.
 *
 * `MiSheet` with its defaults, which are the drawn sheet to the pixel: Dim 45 % surface/inverse,
 * radius 24, Elevation/Sheet, padding 14 / 21 / 34 (plus the safe area) / 21, the 36 × 5 handle.
 * 21 Cancel Trip and 28 Apply Coupon use the same construction.
 *
 * WHAT FIGMA DRAWS, top to bottom (`482:17681`): the handle, the driver's photo (72 circle), the
 * heading (Title 20 over Body S 14 secondary, gap 4, centred), the stars (`236:562`), the review
 * box (`236:568`) and the two actions (gap 12): "Submit Rating" (Primary Button) over "Not now"
 * (Secondary Button Tone=Subtle — white, 1.2 border/handle, which is `MiButton tone="quiet"`).
 *
 * WHEN IT SHOWS: automatically, ONCE, when 30 opens after a payment, and only if the trip is not
 * rated yet. `useRatingState` answers "has this side rated yet" — the sheet is the prompt for a
 * customer who has not, and a customer who has (a re-entry into 30, a replayed payment) is not
 * asked twice. The `asked` ref is what makes it once PER MOUNT rather than once per query
 * resolve: the query's own cache can settle late, and the customer must not see the sheet slide
 * in after they have started reading the screen.
 *
 * TWO WAYS OUT, and both treat the rating as a courtesy rather than a toll:
 * - "Not now", a tap on the dim and Android back all close the sheet and change nothing;
 * - "Submit Rating" sends a picked rating and closes. With NO star picked it does nothing at all:
 *   Figma draws no disabled look, so there is nothing to dim, and a rating the customer did not
 *   give is not something to invent.
 *
 * The close does not wait on the request (21's rule for its confirm): a rating the server refuses
 * must not hold the customer on a sheet they have finished with, and the endpoint upserts, so a
 * retry is safe.
 *
 * DATA: the name and the truck line are the tracking payload's driver, which is the same driver
 * 18–25 drew. Every drawn slot is always rendered; a value the app does not have (the first
 * tracking read, a driver with no photo, a truck with no plate) keeps its drawn size as a
 * placeholder bar rather than being dropped or filled with invented copy.
 */

/** Figma "IMG-01 · Driver photo" `482:17700`: 72 circle. */
const PHOTO_SIZE = 72;
/** Figma Heading `482:17701`: gap 4, both lines centred. */
const HEADING_GAP = 4;
/** Figma Actions `482:17704`: gap 12, both buttons 54 tall. */
const ACTION_GAP = 12;
const ACTION_HEIGHT = 54;

/** Figma text box of the heading's two slots (both `w-full`, i.e. the sheet's 351 content width). */
const HEADING_SLOT_WIDTH = 351;

/**
 * The truck line `482:17703`, VERBATIM format: "Tata 407 (Flatbed) · KA 01 AB 1234" — the make
 * and model with its body type, a middle dot, then the plate. Built from the same two label
 * helpers 18's Vehicle Card uses, so the two can never name the truck differently. With a half
 * missing the other shows alone; `null` (the slot keeps its size) only when neither is known.
 */
function truckLine(driver: TrackedDriverDisplay | null): string | null {
  const model = vehicleModelLabel(driver);
  const plate = vehiclePlateLabel(driver);
  return [model, plate].filter(Boolean).join(' · ') || null;
}

export function RateTripSheet({
  bookingId,
  driver,
}: {
  bookingId: string;
  /** The tracked driver of this trip (`displayDriver(tracking)`); `null` until the first read. */
  driver: TrackedDriverDisplay | null;
}) {
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  /** Whether this mount has already had its one automatic opening. */
  const asked = useRef(false);

  // Read from the mount (30 is on screen and settled) so the answer is in before the sheet slides.
  const { data: ratingState } = useRatingState(bookingId, true);
  const submitRating = useSubmitRating();

  /**
   * The one automatic opening. `ratingState` is `undefined` while the read is in flight and
   * `mine` is null for a trip nobody has rated, so this waits for an ANSWER rather than opening on
   * the gap — otherwise every payment would flash the sheet before the server had a say.
   */
  useEffect(() => {
    if (asked.current || ratingState === undefined) return;
    asked.current = true;
    if (ratingState.mine == null) setVisible(true);
  }, [ratingState]);

  /** "Not now", the dim and Android back: the rating is optional, so the sheet just goes. */
  const dismiss = useCallback(() => {
    if (submitRating.isPending) return;
    setVisible(false);
  }, [submitRating.isPending]);

  /**
   * "Submit Rating": send a picked rating, then close either way. The review is trimmed and only
   * sent when it says something — the contract takes it as optional, and `''` is not a review.
   */
  const submit = useCallback(() => {
    if (rating < 1 || submitRating.isPending) return;
    const trimmed = review.trim();
    submitRating.mutate({
      bookingId,
      body: { rating, ...(trimmed ? { review: trimmed } : {}) },
    });
    setVisible(false);
  }, [bookingId, rating, review, submitRating]);

  const firstName = firstNameOf(driver?.name);
  const truck = truckLine(driver);

  return (
    <MiSheet
      visible={visible}
      onClose={dismiss}
      onBackdropPress={dismiss}
      avoidKeyboard
      /*
        The drawn panel is `items-center` with its full-width children `w-full`: the handle, the
        heading, the review box and the actions stretch (the handle and the box already say so
        themselves), while the photo and the star row are centred by this. `MiSheetPanel` defaults
        to RN's `stretch`, which would left-align those two.
      */
      panelStyle={{ alignItems: 'center' }}
      accessibilityLabel="Rate your trip"
    >
      {/*
        The handle `482:17682` is the panel's own (`MiSheet` draws it as its first child, which is
        exactly the drawn 36 × 5 bar in a centred row) — so nothing extra is added here.
      */}

      {/* IMG-01 · Driver photo `482:17700`: 72 circle. No photo = the drawn empty circle. */}
      <View
        style={{
          width: PHOTO_SIZE,
          height: PHOTO_SIZE,
          borderRadius: mitowRadii.pill,
          backgroundColor: mitowColors.surfaceMuted,
          overflow: 'hidden',
        }}
      >
        {driver?.photoUrl ? (
          <Image
            source={{ uri: driver.photoUrl }}
            resizeMode="cover"
            style={{ width: PHOTO_SIZE, height: PHOTO_SIZE }}
            accessibilityLabel={driver.name ? `${driver.name}'s photo` : 'Driver photo'}
          />
        ) : null}
      </View>

      {/* Heading `482:17701`: gap 4, centred. Title 20, then Body S 14 secondary. */}
      <View style={{ alignSelf: 'stretch', gap: HEADING_GAP, alignItems: 'center' }}>
        {firstName ? (
          <MiText
            variant="title20"
            align="center"
            accessibilityRole="header"
            style={{ alignSelf: 'stretch' }}
          >
            {`How was your tow with ${firstName}?`}
          </MiText>
        ) : (
          <SlotLine variant="title20" />
        )}
        {truck ? (
          <MiText
            variant="bodyS14"
            color="secondary"
            align="center"
            style={{ alignSelf: 'stretch' }}
          >
            {truck}
          </MiText>
        ) : (
          <SlotLine variant="bodyS14" />
        )}
      </View>

      {/* Stars `236:562`: five 37 stars, gap 10.85. */}
      <StarRow value={rating} onChange={setRating} disabled={submitRating.isPending} />

      {/* Review input `236:568`: 351 × 42, surface/muted, radius 12. */}
      <ReviewInput value={review} onChangeText={setReview} editable={!submitRating.isPending} />

      {/* Actions `482:17704`: gap 12. "Submit Rating" dark, "Not now" Secondary Tone=Subtle. */}
      <View style={{ alignSelf: 'stretch', gap: ACTION_GAP }}>
        <MiButton
          tone="dark"
          label="Submit Rating"
          height={ACTION_HEIGHT}
          onPress={submit}
          accessibilityLabel="Submit Rating"
        />
        <MiButton
          tone="quiet"
          label="Not now"
          height={ACTION_HEIGHT}
          onPress={dismiss}
          accessibilityLabel="Not now"
        />
      </View>
    </MiSheet>
  );
}

/**
 * A heading slot with no value yet: the drawn line held open at the drawn width (the slot is
 * `w-full`, so it is the sheet's content width) by a placeholder bar — the same rule
 * `SlotPlaceholder` follows, kept local because that one takes a type variant and these two are
 * the only slots here.
 */
function SlotLine({ variant }: { variant: 'title20' | 'bodyS14' }) {
  return (
    <View style={{ alignSelf: 'stretch', maxWidth: HEADING_SLOT_WIDTH }}>
      <MiText variant={variant} align="center" numberOfLines={1}>
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
