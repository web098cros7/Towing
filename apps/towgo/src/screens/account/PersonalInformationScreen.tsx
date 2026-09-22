import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePressablePrimitive, ErrorState } from '@towing/ui';
import { RefreshCw } from '@/icons';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiButton,
  MiColorIcon,
  MiTextField,
  avatarDefaultIllustration,
  mitowLayout,
  mitowColors,
} from '@/design';
import { useProfile, useUpdateProfile } from '@/features/account/api/profile.queries';
import type { RootStackParamList } from '@/navigation/types';

/**
 * Formats a stored mobile number for display.
 * '+91' followed by exactly 10 digits → '+91 98765 43210' (5 + 5 split).
 * Otherwise returns the value as stored.
 */
function formatMobile(mobile: string): string {
  const match = /^\+91(\d{10})$/.exec(mobile);
  if (match) {
    const digits = match[1];
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return mobile;
}

/**
 * Figma 39 · Personal Information (293:2692).
 *
 * Layout:
 * - Nav bar (293:2692 header)
 * - Photo block (293:2995): 84×84 avatar with camera badge, "Change photo" (293:2999)
 * - Full Name field (293:3000)
 * - Phone Number field (293:3012) — read-only, Verified badge
 * - Email field (293:3024)
 * - Footer: Save Changes (293:3034) drawn at y 755–809 of the 852 frame.
 */
export function PersonalInformationScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const Pressable = usePressablePrimitive();
  const { data: profile, isPending, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [seeded, setSeeded] = useState(false);

  // Seeds once — after that the fields are the user's own edits, not the server's.
  useEffect(() => {
    if (profile && !seeded) {
      setName(profile.name ?? '');
      setEmail(profile.email ?? '');
      setSeeded(true);
    }
  }, [profile, seeded]);

  // No photo-upload flow exists yet for the profile avatar (only the vehicle RC upload does).
  const notReady = useCallback(() => {}, []);

  const save = () => {
    updateProfile.mutate(
      { name: name.trim(), email: email.trim() ? email.trim() : null },
      { onSuccess: () => navigation.goBack() },
    );
  };

  if (isError) {
    return (
      <MiScreen edges={['top']}>
        <View style={{ paddingHorizontal: mitowLayout.sideMargin }}>
          <MiNavBar
            title="Personal Information"
            trailing="none"
            onBack={() => navigation.goBack()}
          />
          <ErrorState
            title="Couldn't load your profile"
            onRetry={() => refetch()}
            icon={RefreshCw}
          />
        </View>
      </MiScreen>
    );
  }

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(insets.bottom, 43),
          }}
        >
          <MiButton
            tone="dark"
            label="Save Changes"
            onPress={save}
            loading={updateProfile.isPending}
            disabled={!name.trim() || !profile}
          />
        </View>
      }
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: 24,
        }}
      >
        <MiNavBar title="Personal Information" trailing="none" onBack={() => navigation.goBack()} />

        {/* Photo 293:2995 */}
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 4 }}>
          <View style={{ position: 'relative', width: 84, height: 84 }}>
            <SvgXml xml={avatarDefaultIllustration} width={84} height={84} />
            <View
              style={{
                position: 'absolute',
                left: 60,
                top: 58,
                width: 26,
                height: 26,
                borderRadius: 13,
                borderWidth: 2,
                borderColor: mitowColors.surfacePage,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MiColorIcon name="camera" size={26} />
            </View>
          </View>
          <Pressable
            onPress={notReady}
            pressScale={1}
            haptic="light"
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change photo"
          >
            <MiText variant="strong14" color="brand">
              Change photo
            </MiText>
          </Pressable>
        </View>

        {/* Full Name 293:3000 */}
        <MiTextField
          label="Full Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoComplete="name"
        />

        {/* Phone Number 293:3012 */}
        <MiTextField
          label="Phone Number"
          value={formatMobile(profile?.mobile ?? '')}
          onChangeText={() => {}}
          disabled
          keyboardType="phone-pad"
          helper="To change your number, contact support."
          rightSlot={
            <MiText variant="strong14" color="success">
              Verified
            </MiText>
          }
        />

        {/* Email 293:3024 */}
        <MiTextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          helper="We send trip receipts and invoices here."
        />
      </ScrollView>
    </MiScreen>
  );
}
