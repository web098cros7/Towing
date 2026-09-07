import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@towing/ui';
import { CreditCard, Wallet } from '@/icons';
import { SubScreen } from '@/components/SubScreen';
import { SettingsList } from '@/components/SettingsList';
import { SettingsRow } from '@/components/SettingsRow';
import { useWallet } from '@/features/payments/api/payments.queries';
import { formatPaise } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';

/**
 * §9.1.9's "saved methods" — and the honest answer to it.
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
  const { data: wallet } = useWallet();

  return (
    <SubScreen title="Payments">
      <View style={{ gap: 20 }}>
        <SettingsList>
          <SettingsRow
            icon={Wallet}
            title="Wallet"
            subtitle="Refunds and credits"
            value={wallet ? formatPaise(wallet.balancePaise) : undefined}
            trailing="chevron"
            onPress={() => navigation.navigate('Wallet')}
          />
        </SettingsList>

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CreditCard size={16} />
            <Text weight="medium" style={{ fontSize: 15, lineHeight: 20 }}>
              Cards and UPI
            </Text>
          </View>
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 19 }}>
            Your cards and UPI IDs are saved securely by our payment provider, not on this device or
            by us. Add or change them from the payment screen when you pay for a trip.
          </Text>
        </View>
      </View>
    </SubScreen>
  );
}
