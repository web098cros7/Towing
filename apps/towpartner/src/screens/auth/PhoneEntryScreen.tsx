import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Text, Button } from '@towing/ui';
import { Phone } from '@/icons';
import { TextField } from '@/components/TextField';
import { useSendOtp } from '@/features/auth/api/auth.queries';
import type { RootStackParamList } from '@/navigation/types';

const DIGITS_ONLY = /\D/g;

export function PhoneEntryScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [digits, setDigits] = useState('');
  const sendOtp = useSendOtp();

  const onChangeDigits = useCallback((value: string) => {
    setDigits(value.replace(DIGITS_ONLY, '').slice(0, 10));
  }, []);

  const submit = useCallback(async () => {
    const mobile = `+91${digits}`;
    try {
      const res = await sendOtp.mutateAsync(mobile);
      navigation.navigate('Otp', {
        challengeId: res.challengeId,
        mobile,
        resendAfterSeconds: res.resendAfterSeconds,
      });
    } catch {
      // Surfaced inline below via sendOtp.error.
    }
  }, [digits, navigation, sendOtp]);

  const valid = /^[6-9]\d{9}$/.test(digits);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 96,
          gap: theme.spacing.xl,
        }}
      >
        <View style={{ gap: 8 }}>
          <Text weight="bold" style={{ fontSize: 28, lineHeight: 34, letterSpacing: -0.5 }}>
            Drive with MiTow Driver
          </Text>
          <Text color="secondary" style={{ fontSize: 15, lineHeight: 21 }}>
            Enter your mobile number — we&apos;ll text you a one-time code to sign in.
          </Text>
        </View>

        <TextField
          label="Mobile number"
          value={digits}
          onChangeText={onChangeDigits}
          keyboardType="number-pad"
          placeholder="98765 43210"
          rightSlot={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Phone size={16} color={theme.colors.textTertiary} />
              <Text color="tertiary">+91</Text>
            </View>
          }
        />

        {sendOtp.isError ? (
          <Text color="error" style={{ fontSize: 13 }}>
            {sendOtp.error instanceof Error ? sendOtp.error.message : 'Something went wrong.'}
          </Text>
        ) : null}

        <Button
          label="Send OTP"
          fullWidth
          disabled={!valid || sendOtp.isPending}
          loading={sendOtp.isPending}
          onPress={submit}
        />
      </View>
    </View>
  );
}
