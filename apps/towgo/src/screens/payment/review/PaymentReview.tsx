import React from 'react';
import { ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiButton,
  MiCard,
  MiColorIcon,
  MiLineIcon,
  MiNavBar,
  MiOptionRow,
  MiScreen,
  MiServiceRow,
  MiSupportCard,
  MiText,
  mitowColors,
  mitowLayout,
  type MiColorIconName,
} from '@/design';
import { PAYMENT_METHOD_LABEL } from '@/features/payments/labels';
import type { PaymentMethodKind } from '@/features/payments/types';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import { useLineBox } from '../paymentDisplay';

/** Methods `239:723`, in drawn order: Icon#238:15 and Subtitle#238:12 VERBATIM (titles: labels.ts). */
const METHOD_ROWS: readonly {
  kind: PaymentMethodKind;
  icon: MiColorIconName;
  subtitle: string;
}[] = [
  { kind: 'upi', icon: 'upi', subtitle: 'Pay using any UPI app' },
  { kind: 'card', icon: 'card', subtitle: 'Visa, Mastercard, RuPay' },
  { kind: 'wallet', icon: 'wallet', subtitle: 'Paytm, PhonePe, Amazon Pay' },
  { kind: 'cash', icon: 'cash', subtitle: 'Pay directly to driver' },
];

/** Amount `239:707` box width ("₹1,200" in Amount 44), for its placeholder bar. */
const TOTAL_SLOT_WIDTH = 142;
/** The home-indicator zone kept clear under the last child (Figma draws no bottom padding). */
const BOTTOM_CLEARANCE = 34;

/** One line of the bill `490:18162` ("Base fare" / "₹700"). `value` null = a placeholder bar. */
export type PaymentBillLine = {
  key: string;
  label: string;
  value: string | null;
  /** Figma draws the Discount value in status/success-text; every other value in text/primary. */
  tone?: 'default' | 'discount';
  /** Figma Value text box width, used only for the placeholder bar. */
  slotWidth?: number;
};

/**
 * Figma 27 · Payment (`238:570`): the review phase of the `Payment` route.
 *
 * Content `239:699` is one column at y 49: padding 0 / 21, gap 16. On 27 (`238:570`) nothing is
 * pinned and the Pay button and the secure note are the column's last two children, so the whole
 * column scrolls on a short phone (it fits the 852 frame exactly). On 28 · Details Open
 * (`490:17845`, drawn at full scroll length) they sit in the pinned Bottom bar `490:18180` (white,
 * 1 border/subtle top, padding 12 / 21 / 34, gap 10) and Content ends with padding 24. Top to
 * bottom: the nav bar (Trailing=None, no Help), Total, the Service summary card, Apply Coupon,
 * "Choose Payment Method" with the four method rows, then Pay and the secure note.
 *
 * DATA: Total and "Pay ₹…" are the intent's `amountPaise`, exactly what will be charged. Until
 * the intent is in, Total holds its drawn size with a placeholder bar and Pay reads "Pay" (its
 * static part); no spinner is drawn for that wait. The Service price is the booking's total, read
 * fresh; the title is the booked service's name (`serviceTitle`, the words Home and 09 use). The
 * description is the trip's route ("Motijheel → Brahmapura"); only while the booking loads do
 * the title and description keep their placeholder bars.
 */
export function PaymentReview({
  amount,
  serviceTitle,
  serviceSubtitle,
  servicePrice,
  method,
  paying,
  detailsOpen,
  bill,
  billTotal,
  onSelectMethod,
  onBack,
  onToggleDetails,
  onApplyCoupon,
  onPay,
}: {
  /** The intent's amount, formatted ("₹1,200"); null while it is not known. */
  amount: string | null;
  /** The booked service's name ("Tow a Car"); null while unknown (the line keeps its bar). */
  serviceTitle: string | null;
  /** The trip as "Motijheel → Brahmapura"; null while the booking loads (the line keeps its bar). */
  serviceSubtitle: string | null;
  /** The booking's total, formatted; null while the booking loads. */
  servicePrice: string | null;
  method: PaymentMethodKind;
  /** A Pay is in flight: Pay shows the button's (undrawn) spinner. */
  paying: boolean;
  /**
   * Figma 28 · Payment · Details Open (`490:17845`): the Service summary shows the bill and Pay +
   * the secure note move into a pinned bottom bar.
   */
  detailsOpen: boolean;
  /** View Details / Hide Details. */
  onToggleDetails: () => void;
  /** The bill's line items, in order. */
  bill: readonly PaymentBillLine[];
  /** The bill's Total value, formatted ("₹1,200"); null = placeholder bar. */
  billTotal: string | null;
  /** The Apply Coupon row. */
  onApplyCoupon: () => void;
  onSelectMethod: (kind: PaymentMethodKind) => void;
  onBack: () => void;
  onPay: () => void;
}) {
  const insets = useSafeAreaInsets();

  const payButton = (
    /* Pay `239:783`: Primary Button, Show icon (arrow-right), label "Pay " + the amount. */
    <MiButton
      tone="dark"
      label={amount ? `Pay ${amount}` : 'Pay'}
      trailingIcon="arrow-right"
      onPress={onPay}
      loading={paying}
    />
  );

  return (
    <MiScreen edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: detailsOpen ? 24 : Math.max(insets.bottom, BOTTOM_CLEARANCE),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Nav bar `258:1438`: Nav Bar Trailing=None, title "Payment". No Help chip (29 has one). */}
        <MiNavBar title="Payment" trailing="none" onBack={onBack} />

        <TotalBlock amount={amount} />

        <ServiceSummary
          title={serviceTitle}
          subtitle={serviceSubtitle}
          price={servicePrice}
          open={detailsOpen}
          onToggle={onToggleDetails}
          bill={bill}
          billTotal={billTotal}
        />

        {/* Apply coupon `253:1153`: Menu Card holding one Menu Row (icon/color/tag 34, "Apply Coupon", chevron-right 20), 60 tall. MiSupportCard, as on 58 and 26, so the whole card presses. It opens 28 · Apply Coupon. */}
        <MiSupportCard icon="tag" title="Apply Coupon" onPress={onApplyCoupon} />

        {/* Payment methods `239:721`: gap 12, heading then Methods `239:723` (gap 8). */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18" accessibilityRole="header">
            Choose Payment Method
          </MiText>
          {/* Payment Method Row `238:519`, the component 11 / 12 instance: MiOptionRow. */}
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {METHOD_ROWS.map((row) => (
              <MiOptionRow
                key={row.kind}
                icon={row.icon}
                title={PAYMENT_METHOD_LABEL[row.kind]}
                subtitle={row.subtitle}
                selected={method === row.kind}
                onPress={() => onSelectMethod(row.kind)}
              />
            ))}
          </View>
        </View>

        {!detailsOpen && (
          <>
            {payButton}

            <SecureNote />
          </>
        )}
      </ScrollView>

      {detailsOpen && (
        /* Bottom bar `490:18180`: white, 1 border/subtle top, padding 12 / 21 / 34, gap 10. */
        <View
          style={{
            backgroundColor: mitowColors.surfacePage,
            borderTopWidth: 1,
            borderTopColor: mitowColors.borderSubtle,
            paddingTop: 12,
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(insets.bottom, BOTTOM_CLEARANCE),
            gap: 10,
          }}
        >
          {payButton}

          <SecureNote />
        </View>
      )}
    </MiScreen>
  );
}

/**
 * Total `239:706`: a centred column, gap 2. The amount in MiTow/Amount 44, then "Total Amount"
 * in Body M 15 secondary. Read as one element.
 */
function TotalBlock({ amount }: { amount: string | null }) {
  return (
    <View
      accessible
      accessibilityLabel={amount ? `Total amount, ${amount}` : 'Total amount'}
      style={{ alignItems: 'center', gap: 2 }}
    >
      {amount ? (
        <MiText variant="amount44" numberOfLines={1}>
          {amount}
        </MiText>
      ) : (
        <SlotPlaceholder variant="amount44" width={TOTAL_SLOT_WIDTH} />
      )}
      <MiText variant="bodyM15" color="secondary" numberOfLines={1}>
        Total Amount
      </MiText>
    </View>
  );
}

/**
 * Service summary `239:709`: radius 16, 1.2 border/subtle INSIDE and not in layout, Elevation/Card,
 * padding 12 / 14 from the outer edge (so 1.2 less here, where the RN border takes layout space,
 * as 20's Locations card does), gap 10. Service Row, a 1-tall divider, then "View Details" with
 * the chevron-right turned to point down (Figma −90°, 90° clockwise on screen). On 28's open state
 * `490:17851` the same card reads "Hide Details" with the chevron pointing up, then Bill `490:18162`.
 */
function ServiceSummary({
  title,
  subtitle,
  price,
  open,
  onToggle,
  bill,
  billTotal,
}: {
  title: string | null;
  subtitle: string | null;
  price: string | null;
  open: boolean;
  onToggle: () => void;
  bill: readonly PaymentBillLine[];
  billTotal: string | null;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <MiCard
      radius={16}
      borderWidth={1.2}
      elevation="card"
      paddingVertical={10.8}
      paddingHorizontal={12.8}
      gap={10}
    >
      {/* Service `243:878`: the service, and the trip's route under it. */}
      <MiServiceRow title={title} subtitle={subtitle} price={price} />

      {/* Divider `239:716`: 1 tall, border/subtle. */}
      <View style={{ height: 1, backgroundColor: mitowColors.borderSubtle }} />

      {/* View details `239:717`: 24 tall (the chevron box sets it), gap 0. */}
      <Pressable
        onPress={onToggle}
        pressScale={theme.motion.pressScale.row}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide details' : 'View details'}
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        <MiText variant="bodyM15" color="secondary" numberOfLines={1} style={{ flex: 1 }}>
          {open ? 'Hide Details' : 'View Details'}
        </MiText>
        <View
          style={{
            width: 24,
            height: 24,
            transform: [{ rotate: open ? '-90deg' : '90deg' }],
          }}
        >
          <MiLineIcon name="chevron-right" size={24} />
        </View>
      </Pressable>

      {open && <BillDetails lines={bill} total={billTotal} />}
    </MiCard>
  );
}

/**
 * Bill `490:18162` (28 · Details Open): a column, gap 14, padding-top 4, clips. Each line is a row,
 * space-between, items centred: the label in Body M 15 secondary, the value in Strong 15 (primary,
 * or success for the Discount). Then a 1-tall border/subtle divider, then Total: "Total" in Strong
 * 16 and the value in Title 20, both primary.
 */
function BillDetails({
  lines,
  total,
}: {
  lines: readonly PaymentBillLine[];
  total: string | null;
}) {
  return (
    <View style={{ gap: 14, paddingTop: 4, overflow: 'hidden' }}>
      {lines.map((line) => (
        <View
          key={line.key}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
          accessible
          accessibilityLabel={line.value ? `${line.label}, ${line.value}` : line.label}
        >
          <MiText variant="bodyM15" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {line.label}
          </MiText>
          {line.value ? (
            <MiText
              variant="strong15"
              color={line.tone === 'discount' ? 'success' : 'primary'}
              numberOfLines={1}
            >
              {line.value}
            </MiText>
          ) : (
            <SlotPlaceholder variant="strong15" width={line.slotWidth ?? 37} />
          )}
        </View>
      ))}

      <View style={{ height: 1, backgroundColor: mitowColors.borderSubtle }} />

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
        accessible
        accessibilityLabel={total ? `Total, ${total}` : 'Total'}
      >
        <MiText variant="strong16">Total</MiText>
        {total ? (
          <MiText variant="title20" numberOfLines={1}>
            {total}
          </MiText>
        ) : (
          <SlotPlaceholder variant="title20" width={66} />
        )}
      </View>
    </View>
  );
}

/**
 * Secure note `239:787`: centred. Note `239:788` is a row (gap 10, items centred) of
 * icon/color/verified at 30 (27's own frame; 28's backdrop draws 26, D7) and a text column:
 * "100% Secure Payments" (Chip 13.5) over "Your payment information is encrypted" (Label 13
 * secondary, boxed at 17 as Figma boxes it). Not pressable; read as one element.
 */
function SecureNote() {
  const lineBox = useLineBox('label13');

  return (
    <View
      accessible
      accessibilityLabel="100% Secure Payments. Your payment information is encrypted"
      style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
        <MiColorIcon name="verified" size={30} />
        <View style={{ flexShrink: 1 }}>
          <MiText variant="chip135">100% Secure Payments</MiText>
          <MiText variant="label13" color="secondary" style={{ minHeight: lineBox }}>
            Your payment information is encrypted
          </MiText>
        </View>
      </View>
    </View>
  );
}
