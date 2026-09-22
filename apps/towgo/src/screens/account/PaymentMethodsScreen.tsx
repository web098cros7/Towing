import React from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePressablePrimitive } from '@towing/ui';
import { useTheme } from '@towing/theme';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiColorIcon,
  MiLineIcon,
  MiMenuCard,
  MiMenuRow,
  MiInfoBanner,
  mitowColors,
} from '@/design';
import { useWallet } from '@/features/payments/api/payments.queries';
import { formatPaise } from '@/utils/format';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import type { RootStackParamList } from '@/navigation/types';

/**
 * Figma 43 · Payment Methods (295:3069).
 *
 * ⚠ THIS APP DELIBERATELY DOES NOT STORE PAYMENT INSTRUMENTS. §9.1.9's
 * acceptance criterion is "no raw card data stored", and the surest way to
 * satisfy that is for card data never to reach this app at all: Razorpay's
 * checkout sheet owns saved cards, saved UPI handles and the tokenisation
 * behind them, on Razorpay's side of the boundary. Building a vault here to
 * mirror theirs would be a second copy of the most sensitive data in the
 * product, for no gain.
 *
 * WHAT THIS SCREEN WAS UNTIL PHASE 19: a 39-line stub over
 * `paymentMethods.mock.ts` — "HDFC Visa •••• 4321" and a UPI handle, hardcoded
 * — with an "Add Payment Method" button wired to `const notReady = () => {}`
 * and every row's `onPress` wired to the same. It has been showing a fictional
 * card to every customer since Phase 12.
 */
export function PaymentMethodsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const Pressable = usePressablePrimitive();
  const { data: wallet } = useWallet();

  const balanceLabel = wallet ? formatPaise(wallet.balancePaise) : '';

  return (
    <MiScreen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 21,
          gap: 16,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
      >
        <MiNavBar title="Payment Methods" trailing="none" onBack={() => navigation.goBack()} />

        {/* MiTow Wallet card — Figma 295:3236 */}
        <Pressable
          pressScale={theme.motion.pressScale.row}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={`MiTow Wallet, refunds and credits, ${balanceLabel}`}
          onPress={() => navigation.navigate('Wallet')}
          style={{
            backgroundColor: mitowColors.surfaceInverse,
            borderRadius: 16,
            padding: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          {/* Icon holder — Figma 295:3237 */}
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MiColorIcon name="wallet" size={34} />
          </View>

          {/* Text — Figma 295:3239 */}
          <View style={{ flex: 1, gap: 2 }}>
            <MiText variant="strong16" color="onDark">
              MiTow Wallet
            </MiText>
            <MiText variant="bodyS14" color="onDark">
              Refunds and credits
            </MiText>
          </View>

          {/* Balance — Figma 295:3242 */}
          {wallet ? (
            <MiText variant="title20" color="onDark">
              {formatPaise(wallet.balancePaise)}
            </MiText>
          ) : (
            <SlotPlaceholder variant="title20" width={50} />
          )}

          <MiLineIcon name="chevron-right" size={20} color={mitowColors.textOnDark} />
        </Pressable>

        {/* Cards and UPI — Figma 295:3245 */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">Cards and UPI</MiText>
          <MiInfoBanner
            tone="muted"
            icon="verified"
            title="Saved by our payment partner"
            subtitle="Not on your phone or by us. Add or change cards and UPI at checkout."
            height={85}
          />
        </View>

        {/* Ways to Pay — Figma 295:3256 */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">Ways to Pay</MiText>
          <MiMenuCard radius={16} paddingVertical={4}>
            <MiMenuRow icon={{ color: 'upi' }} title="UPI" subtitle="Pay using any UPI app" />
            <MiMenuRow
              icon={{ color: 'card' }}
              title="Credit / Debit Card"
              subtitle="Visa, Mastercard, RuPay"
            />
            <MiMenuRow
              icon={{ color: 'wallet' }}
              title="Wallet"
              subtitle="Paytm, PhonePe, Amazon Pay"
            />
            <MiMenuRow icon={{ color: 'cash' }} title="Cash" subtitle="Pay directly to driver" />
          </MiMenuCard>
        </View>
      </ScrollView>
    </MiScreen>
  );
}
