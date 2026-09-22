import React from 'react';
import { ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MiButton,
  MiCard,
  MiDetailRow,
  MiInfoBanner,
  MiLineIcon,
  MiNavBar,
  MiScreen,
  MiText,
  mitowColors,
  mitowLayout,
  mitowRadii,
} from '@/design';
import { PAYMENT_METHOD_LABEL } from '@/features/payments/labels';
import { formatPaise } from '@/utils/format';
import type { PaymentFailure } from '../usePaymentSession';

/** Try Again / Use Another Method: the lower button's bottom edge sits 43 above the 852 frame. */
const FOOTER_BOTTOM_GAP = 43;
/** The 852 frame's home-indicator zone inside that 43; the rest (9) stays clear above any bar. */
const HOME_INDICATOR_ZONE = 34;
/** Trip is safe `292:2711`: the Info Banner instance's fixed height (the master is 67). */
const BANNER_HEIGHT = 85;
/** Failure mark `292:2705`: 88 circle, icon/close at 40. */
const MARK_SIZE = 88;
/** Figma value boxes of the Reason and Reference ID rows, for their placeholder bars. */
const REASON_SLOT_WIDTH = 121;
const REFERENCE_SLOT_WIDTH = 123;

/**
 * Figma 29 · Payment Failed (`292:2522`): the `failed` phase of the `Payment` route (29 spec
 * D1 = A), so the payment session (key, intent, 27's method) carries straight on into Try Again.
 *
 * Content `292:2690` scrolls: the nav bar (Trailing=Help, title "Payment"), the Result (the
 * failure mark, "Payment failed" and the body), the "Your trip is safe" banner and Payment
 * Details. Try Again and Use Another Method are direct children of the frame, not of Content,
 * so they are a pinned footer (gap 10), with 58's bottom rule at the drawn 43.
 *
 * Shown only for a definite decline (the body says the bank declined and no money was taken);
 * see `usePaymentSession`.
 */
export function PaymentFailedView({
  failure,
  reference,
  retrying,
  onBack,
  onHelp,
  onTryAgain,
  onUseAnotherMethod,
}: {
  failure: PaymentFailure;
  /** The booking reference, the same field Booking Details reads; null until it is known. */
  reference: string | null;
  /** Try Again is in flight: its (undrawn) spinner shows, and the other controls wait. */
  retrying: boolean;
  onBack: () => void;
  onHelp: () => void;
  onTryAgain: () => void;
  onUseAnotherMethod: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            gap: 10,
            // 23's max(drawn, drawn − 34 + inset) rule: exactly 43 on iPhone 16, and the drawn 9
            // above the home-indicator zone kept above a taller system navigation bar.
            paddingBottom: Math.max(
              FOOTER_BOTTOM_GAP,
              insets.bottom + FOOTER_BOTTOM_GAP - HOME_INDICATOR_ZONE,
            ),
          }}
        >
          {/* Try Again `292:2735`: Primary Button, no icons. */}
          <MiButton tone="dark" label="Try Again" onPress={onTryAgain} loading={retrying} />
          {/* Use Another Method `292:2741`: Secondary Button Tone=Subtle, no icon. */}
          <MiButton
            tone="secondarySubtle"
            label="Use Another Method"
            onPress={onUseAnotherMethod}
          />
        </View>
      }
    >
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Nav bar `292:2691`: Nav Bar Trailing=Help, the same title as 27. */}
        <MiNavBar title="Payment" trailing="help" onBack={onBack} onHelp={onHelp} />

        {/* Result `292:2704`: padding top 8, gap 12, centred. */}
        <View style={{ paddingTop: 8, gap: 12, alignItems: 'center' }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: MARK_SIZE,
              height: MARK_SIZE,
              borderRadius: mitowRadii.pill,
              backgroundColor: mitowColors.dangerSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MiLineIcon name="close" size={40} color={mitowColors.danger} />
          </View>
          {/* Text `292:2708`: fills the width, gap 6. The body wraps to two lines, no "\n". */}
          <View style={{ alignSelf: 'stretch', gap: 6 }}>
            <MiText variant="display27" align="center" accessibilityRole="header">
              Payment failed
            </MiText>
            <MiText variant="bodyL155" color="secondary" align="center">
              Your bank declined this payment. No money was taken from your account.
            </MiText>
          </View>
        </View>

        {/* Trip is safe `292:2711`: Info Banner, master fill, stock verified shield, no chevron. */}
        <MiInfoBanner
          icon="verified"
          height={BANNER_HEIGHT}
          title="Your trip is safe"
          subtitle="Try again, or pay with another method. Cash to the driver also works."
        />

        {/* Payment details `292:2720`: gap 12, the heading outside the card. */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18" accessibilityRole="header">
            Payment Details
          </MiText>
          {/* Card `292:2722`: padding 16 inside the 1.2 border (stroke in layout), gap 14. */}
          <MiCard padding={16} gap={14}>
            <MiDetailRow label="Amount" value={formatPaise(failure.amountPaise)} />
            {/* No instrument (UPI handle, card digits) exists anywhere: the label alone. */}
            <MiDetailRow label="Payment method" value={PAYMENT_METHOD_LABEL[failure.method]} />
            {/* A reason or reference the app lacks keeps its slot with a placeholder bar. */}
            <MiDetailRow
              label="Reason"
              value={failure.reason}
              valueSlotWidth={REASON_SLOT_WIDTH}
              valueColor="danger"
            />
            <MiDetailRow
              label="Reference ID"
              value={reference}
              valueSlotWidth={REFERENCE_SLOT_WIDTH}
            />
          </MiCard>
        </View>
      </ScrollView>
    </MiScreen>
  );
}
