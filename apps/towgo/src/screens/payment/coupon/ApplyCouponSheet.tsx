
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import type { CouponValidationDto } from '@towing/api-contracts';
import { MiButton, MiColorIcon, MiSheet, MiText, MiTextField } from '@/design';
import { useCouponOffers, useValidateCoupon } from '@/features/payments/api/payments.queries';
import { couponMessage } from '@/features/payments/couponMessage';
import { formatPaise } from '@/utils/format';
import { OfferRow } from './OfferRow';

/** `couponValidateRequestSchema`: a code is 3 to 32 characters. Shorter is never sent. */
const MIN_CODE_LENGTH = 3;
const MAX_CODE_LENGTH = 32;

const sameCode = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Figma 28 · Apply Coupon (`299:3816`): a modal bottom sheet `299:4063` over 27, which it leaves
 * as the backdrop. `MiSheet` with its defaults, which are exactly the drawn sheet (Dim 45 %,
 * radius 24, Elevation/Sheet, padding 14 / 21 / 34 plus the safe area / 21, gap 16, the handle),
 * as 21 Cancel Trip uses it. Its height hugs; `scrollable` and `avoidKeyboard` keep Done in reach
 * once the (undrawn) keyboard is up. Top to bottom: the heading, the coupon field, "Available
 * offers" and Done.
 *
 * 27's Apply Coupon row (`253:1153`) opens it.
 *
 * A code is applied through `useValidateCoupon`, from an offer's "Apply" or the keyboard's return
 * key (no Apply button is drawn beside the field). One coupon per trip: a new one replaces the
 * old. The caller re-creates the payment intent on every apply and remove, so 27's Total and Pay
 * always show the discounted charge. Done and Android back close the sheet and keep the coupon.
 */
export function ApplyCouponSheet({
  visible,
  onClose,
  subtotalPaise,
  applied,
  onApplied,
  onRemoved,
}: {
  visible: boolean;
  /** Done and Android back: the coupon stays applied. */
  onClose: () => void;
  /** What the code is checked against: the booking's total. Null until the booking is read. */
  subtotalPaise: number | null;
  /** The coupon applied this payment session, if any. */
  applied: CouponValidationDto | null;
  onApplied: (coupon: CouponValidationDto) => void;
  onRemoved: () => void;
}) {
  // Read from the moment 27 mounts (this sheet is mounted with it), not from the open: offers
  // landing after the slide-in made the sheet jump 258 pt taller.
  const { data: offers } = useCouponOffers(true);
  const validate = useValidateCoupon();

  const [draft, setDraft] = useState(applied?.code ?? '');
  /** The last refusal, and the code it was for: shown only while the field still holds that code. */
  const [refused, setRefused] = useState<{ code: string; result: CouponValidationDto } | null>(
    null,
  );

  /**
   * Bumped by every check, Remove, keystroke and close: a check's answer is used only if nothing
   * has happened since it was sent and the sheet is still open. Otherwise a late answer could
   * re-apply a code the customer just removed or retyped, or apply one after Done, while 27 is
   * already paying (the intent would change under the checkout).
   */
  const checkSeq = useRef(0);
  /** Whether the sheet is open, for an answer that lands after it closed. */
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) checkSeq.current += 1;
  }, [visible]);

  // Opening shows the applied code (or an empty field). The reset happens while RENDERING the
  // open, as 21 does, so the previous opening's draft is never painted first.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(applied?.code ?? '');
      setRefused(null);
    }
  }

  const check = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (trimmed.length < MIN_CODE_LENGTH || subtotalPaise === null || validate.isPending) return;
      const seq = ++checkSeq.current;
      setDraft(trimmed);
      setRefused(null);
      try {
        const result = await validate.mutateAsync({ code: trimmed, subtotalPaise });
        // Removed, retyped, re-checked or closed since: this answer is stale.
        if (seq !== checkSeq.current || !visibleRef.current) return;
        if (result.valid && result.code) {
          // The server's casing wins in the field and the helper.
          setDraft(result.code);
          onApplied(result);
        } else {
          setRefused({ code: trimmed, result });
        }
      } catch {
        // A failed check (network) is not a refusal, so the field is left as typed. Figma
        // draws no failed state: a system alert, unless the answer is stale anyway.
        if (seq !== checkSeq.current || !visibleRef.current) return;
        Alert.alert("Couldn't check the code", 'Check your connection and try again.');
      }
    },
    [onApplied, subtotalPaise, validate],
  );

  const onChangeDraft = useCallback((value: string) => {
    checkSeq.current += 1;
    setDraft(value);
    setRefused(null);
  }, []);

  /**
   * "Remove". With the applied code in the field, it removes the coupon and clears the field.
   * Otherwise (a code being typed, or a refused one) it only puts the field back to the applied
   * code, or empty when none is applied, and drops the refusal: the coupon stays.
   */
  const remove = useCallback(() => {
    checkSeq.current += 1;
    setRefused(null);
    if (applied && sameCode(draft, applied.code)) {
      setDraft('');
      onRemoved();
    } else {
      setDraft(applied?.code ?? '');
    }
  }, [applied, draft, onRemoved]);

  /** Done and Android back: drop any pending answer before the sheet goes. */
  const close = useCallback(() => {
    checkSeq.current += 1;
    onClose();
  }, [onClose]);

  const showsApplied = applied !== null && sameCode(draft, applied.code);
  const showsRefusal = refused !== null && sameCode(draft, refused.code);

  let helper: string | undefined;
  if (showsApplied && applied) {
    // Helper `I299:4069;281:1680`, VERBATIM pattern.
    helper = `${applied.code} applied. You save ${formatPaise(applied.discountPaise)} on this trip.`;
  } else if (showsRefusal && refused) {
    // Not in Figma (27-28 Data gap 9): the app's existing refusal copy.
    helper = couponMessage(refused.result);
  }

  return (
    <MiSheet
      visible={visible}
      onClose={close}
      avoidKeyboard
      scrollable
      accessibilityLabel="Apply coupon"
    >
      {/* Heading `299:4066`: gap 4. Title 23 ("coupon" lower case), then Body M 15 secondary. */}
      <View style={{ gap: 4 }}>
        <MiText variant="title23" accessibilityRole="header">
          Apply coupon
        </MiText>
        <MiText variant="bodyM15" color="secondary">
          One coupon per trip. Savings show on the bill.
        </MiText>
      </View>

      {/*
        Coupon code `299:4069`: Text Field, no label, leading icon/color/tag 22, action "Remove",
        helper in status/success-text when applied. The action shows while the field holds
        something (the empty field is not drawn).
      */}
      <MiTextField
        value={draft}
        onChangeText={onChangeDraft}
        leftSlot={<MiColorIcon name="tag" size={22} />}
        actionLabel={draft.length > 0 ? 'Remove' : undefined}
        onAction={remove}
        actionAccessibilityLabel="Remove coupon"
        helper={helper}
        helperTone={showsApplied ? 'success' : undefined}
        error={showsRefusal}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        onSubmitEditing={() => void check(draft)}
        maxLength={MAX_CODE_LENGTH}
        accessibilityLabel="Coupon code"
      />

      {/* Available offers `299:4079`: gap 10, the heading then one row per offer. */}
      <View style={{ gap: 10 }}>
        <MiText variant="heading18" accessibilityRole="header">
          Available offers
        </MiText>
        {(offers ?? []).map((offer) => (
          <OfferRow
            key={offer.code}
            offer={offer}
            applied={applied !== null && sameCode(offer.code, applied.code)}
            onApply={() => void check(offer.code)}
          />
        ))}
      </View>

      {/* Done `299:4102`: Primary Button, Show icon off (15's "Got It" construction). */}
      <MiButton tone="dark" label="Done" onPress={close} />
    </MiSheet>
  );
}


