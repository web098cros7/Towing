import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Screen, StatusBadge, Text } from '@towing/ui';
import { IFSC_REGEX } from '@towing/api-contracts';
import { DriverHeader } from '@/components/DriverHeader';
import { TextField } from '@/components/TextField';
import {
  useLinkPayoutAccount,
  usePayoutAccount,
} from '@/features/earnings/api/earnings.queries';

/**
 * §9.2.4's Route linked-account onboarding, driver side.
 *
 * ⚠ THIS WAS A `PlaceholderScreen` ("Coming soon") from Phase 12 until Phase
 * 19 — the Profile menu has had a "Bank Details" row pointing at nothing for
 * seven phases, because there was nowhere for the money to go.
 *
 * THE FULL ACCOUNT NUMBER NEVER COMES BACK. It goes to the server, which
 * forwards it to Razorpay Route and persists only the last four digits and a
 * SHA-256 fingerprint — enough to answer "did they change the account?" without
 * being able to answer "what is it?". So this screen shows a masked account
 * once linked and asks for the whole thing again to change it, which is the
 * honest consequence rather than an inconvenience.
 */
export function BankDetailsScreen() {
  const navigation = useNavigation();
  const { data: account } = usePayoutAccount();
  const link = useLinkPayoutAccount();

  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [editing, setEditing] = useState(false);

  const linked = account?.status === 'active';
  const showForm = editing || !linked;

  // The same rules the contract enforces server-side. Client-side so the
  // driver is told before they submit, never instead of the server checking.
  const ifscValid = IFSC_REGEX.test(ifsc.trim().toUpperCase());
  const numberValid = /^\d{6,20}$/.test(accountNumber.trim());
  const nameValid = beneficiaryName.trim().length >= 2;
  const canSubmit = ifscValid && numberValid && nameValid && !link.isPending;

  const submit = (): void => {
    link.mutate(
      {
        beneficiaryName: beneficiaryName.trim(),
        accountNumber: accountNumber.trim(),
        ifsc: ifsc.trim().toUpperCase(),
      },
      {
        onSuccess: () => {
          setEditing(false);
          setAccountNumber('');
        },
      },
    );
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 32 }}>
      <DriverHeader
        leading="back"
        title="Bank Details"
        titleSize={22}
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        {linked && account ? (
          <Card padding={20} bordered>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text weight="semibold" style={{ fontSize: 16, lineHeight: 22 }}>
                {account.bankName ?? 'Bank account'}
              </Text>
              <StatusBadge label="Linked" tone="success" pill />
            </View>

            <Text color="secondary" style={{ fontSize: 14, lineHeight: 20, marginTop: 8 }}>
              {account.beneficiaryName}
            </Text>
            <Text color="secondary" tabular style={{ fontSize: 14, lineHeight: 20 }}>
              {/* The only account-number form that exists on this device. */}
              •••• {account.accountNumberLast4}
            </Text>
            <Text color="tertiary" style={{ fontSize: 12, lineHeight: 17, marginTop: 2 }}>
              {account.ifsc}
            </Text>

            {!editing ? (
              <View style={{ marginTop: 16 }}>
                <Button
                  variant="secondary"
                  label="Change bank account"
                  onPress={() => setEditing(true)}
                  accessibilityLabel="Change bank account"
                  fullWidth
                />
              </View>
            ) : null}
          </Card>
        ) : null}

        {account?.status === 'pending' ? (
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 19 }}>
            We are verifying this account with your bank. Payouts will work once it clears.
          </Text>
        ) : null}

        {account?.status === 'rejected' && account.failureReason ? (
          <Text style={{ fontSize: 13, lineHeight: 19, color: '#DC2626' }}>
            {account.failureReason}
          </Text>
        ) : null}

        {showForm ? (
          <View style={{ gap: 14 }}>
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 19 }}>
              Payouts go to this account. The name must match the account exactly, or your bank will
              reject the transfer.
            </Text>

            <TextField
              label="Account holder name"
              value={beneficiaryName}
              onChangeText={setBeneficiaryName}
            />
            <TextField
              label="Account number"
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="number-pad"
            />
            <TextField
              label="IFSC"
              value={ifsc}
              onChangeText={(value) => setIfsc(value.toUpperCase())}
              autoCapitalize="characters"
            />
            {ifsc.length > 0 && !ifscValid ? (
              <Text style={{ fontSize: 12, lineHeight: 17, color: '#DC2626', marginTop: -8 }}>
                Enter a valid IFSC, e.g. HDFC0000123
              </Text>
            ) : null}

            {link.isError ? (
              <Text style={{ fontSize: 13, lineHeight: 19, color: '#DC2626' }}>
                {(link.error as Error).message}
              </Text>
            ) : null}

            <Button
              label={link.isPending ? 'Linking…' : 'Save bank account'}
              onPress={submit}
              disabled={!canSubmit}
              accessibilityLabel="Save bank account"
              fullWidth
            />

            {editing ? (
              <Button
                variant="ghost"
                label="Cancel"
                onPress={() => setEditing(false)}
                accessibilityLabel="Cancel bank account change"
                fullWidth
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
