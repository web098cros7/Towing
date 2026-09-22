import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePressablePrimitive } from '@towing/ui';

import {
  MiScreen,
  MiText,
  MiNavBar,
  MiButton,
  MiColorIcon,
  mitowColors,
  mitowLayout,
  mitowRadii,
  mitowShadows,
} from '@/design';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';
import type { RootStackParamList } from '@/navigation/types';
import { useReferral } from '@/features/referrals/api/referrals';
import { copyText } from '@/lib/clipboard';
import { formatPaise } from '@/utils/format';

/**
 * Refer & Earn — Figma 45 · Refer & Earn (298:3586).
 */
export function ReferEarnScreen(): React.ReactElement {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useReferral();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const code = data?.code;
  const shareUrl = data?.shareUrl;
  const refereeRewardPaise = data?.refereeRewardPaise;
  const referrerRewardPaise = data?.referrerRewardPaise;

  const handleCopy = useCallback(() => {
    if (!code) return;
    copyText(code).catch(() => {});
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleShare = useCallback(() => {
    if (!code || !shareUrl || refereeRewardPaise === undefined) return;
    Share.share({
      message: `Join me on MiTow! Use my code ${code} to get ${formatPaise(
        refereeRewardPaise,
      )} off your first tow: ${shareUrl}`,
    }).catch(() => {});
  }, [code, shareUrl, refereeRewardPaise]);

  const Pressable = usePressablePrimitive();

  const step2Subtitle =
    refereeRewardPaise !== undefined
      ? `They get ${formatPaise(refereeRewardPaise)} off their first trip`
      : 'They get ₹100 off their first trip';

  const step3Title =
    referrerRewardPaise !== undefined
      ? `You earn ${formatPaise(referrerRewardPaise)}`
      : 'You earn ₹100';

  return (
    <MiScreen edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 34) }]}
        showsVerticalScrollIndicator={false}
      >
        <MiNavBar title="Refer & Earn" trailing="none" onBack={() => navigation.goBack()} />

        {/* ILL-08 (387:18551) — drawn 335×188, centred, 7.5 in from the 351 column */}
        <Image
          source={require('@/assets/illustrations/refer-friend.png')}
          style={styles.illustration}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />

        {/* Referral code (298:3809) */}
        <View style={styles.codeCard}>
          <View style={styles.codeColumn}>
            <MiText variant="bodyS14" color="secondary">
              Your referral code
            </MiText>
            {isLoading || !code ? (
              <SlotPlaceholder variant="title20" width={104} />
            ) : (
              <MiText variant="title20">{code}</MiText>
            )}
          </View>
          {/* Copy (298:3813) */}
          <Pressable
            onPress={handleCopy}
            disabled={!code}
            hitSlop={10}
            pressScale={1}
            style={styles.copyRow}
            accessibilityRole="button"
            accessibilityLabel="Copy referral code"
          >
            <MiColorIcon name="copy" size={20} />
            <MiText variant="strong15" color="brand">
              {copied ? 'Copied' : 'Copy'}
            </MiText>
          </Pressable>
        </View>

        {/* Share Invite Link (298:3816) */}
        <MiButton
          tone="dark"
          label="Share Invite Link"
          disabled={isLoading || !code}
          onPress={handleShare}
        />

        {/* How it works (298:3822) */}
        <View style={styles.howItWorks}>
          <MiText variant="heading18">How it works</MiText>
          <View style={styles.stepsCard}>
            <StepRow
              index="1"
              title="Share your code"
              subtitle="Send it on WhatsApp, SMS or anywhere"
            />
            <View style={styles.divider} />
            <StepRow
              index="2"
              title="Your friend books a tow"
              subtitle={step2Subtitle}
            />
            <View style={styles.divider} />
            <StepRow index="3" title={step3Title} subtitle="Credited to your MiTow Wallet" />
          </View>
        </View>

        {/* Your rewards (298:3847) */}
        <View style={styles.rewardsCard}>
          <View style={styles.rewardColumn}>
            <MiText variant="bodyS14" color="secondary">
              Friends joined
            </MiText>
            {isLoading || !data ? (
              <SlotPlaceholder variant="title20" width={13} />
            ) : (
              <MiText variant="title20">{String(data.invitedCount)}</MiText>
            )}
          </View>
          <View style={styles.rewardDivider} />
          <View style={[styles.rewardColumn, styles.rewardColumnRight]}>
            <MiText variant="bodyS14" color="secondary">
              You earned
            </MiText>
            {isLoading || !data ? (
              <SlotPlaceholder variant="title20" width={51} />
            ) : (
              <MiText variant="title20">{formatPaise(data.earnedPaise)}</MiText>
            )}
          </View>
        </View>
      </ScrollView>
    </MiScreen>
  );
}

interface StepRowProps {
  index: string;
  title: string;
  subtitle: string;
}

function StepRow({ index, title, subtitle }: StepRowProps): React.ReactElement {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepDisc}>
        <MiText variant="strong14" color="brand">
          {index}
        </MiText>
      </View>
      <View style={styles.stepTextColumn}>
        <MiText variant="bodyM15">{title}</MiText>
        <MiText variant="bodyS14" color="secondary">
          {subtitle}
        </MiText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: mitowLayout.sideMargin,
    gap: mitowLayout.blockGap,
  },
  illustration: {
    width: 335,
    height: 188,
    alignSelf: 'center',
    marginTop: -2.5,
    marginBottom: -14.5,
  },
  codeCard: {
    height: 78,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: mitowColors.brandYellow,
    backgroundColor: mitowColors.surfacePage,
    paddingHorizontal: 14.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  codeColumn: {
    flex: 1,
    gap: 2,
  },
  copyRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  howItWorks: {
    gap: mitowLayout.headingGap,
  },
  stepsCard: {
    backgroundColor: mitowColors.surfacePage,
    borderWidth: 1.2,
    borderColor: mitowColors.borderSubtle,
    borderRadius: mitowRadii.card,
    paddingVertical: 2.8,
    ...mitowShadows.card,
  },
  divider: {
    height: 1,
    marginLeft: 60.8,
    backgroundColor: mitowColors.borderSubtle,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12.8,
    paddingVertical: 10,
  },
  stepDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: mitowColors.brandYellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTextColumn: {
    flex: 1,
    gap: 1,
  },
  rewardsCard: {
    height: 77.4,
    backgroundColor: mitowColors.surfacePage,
    borderWidth: 1.2,
    borderColor: mitowColors.borderSubtle,
    borderRadius: mitowRadii.card,
    ...mitowShadows.card,
    paddingHorizontal: 14.8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rewardColumn: {
    flex: 1,
    gap: 2,
  },
  rewardColumnRight: {
    paddingLeft: 16,
  },
  rewardDivider: {
    width: 1,
    height: 40,
    backgroundColor: mitowColors.borderSubtle,
  },
});
