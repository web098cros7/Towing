import React from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

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

/**
 * Refer & Earn — Figma 45 · Refer & Earn (298:3586).
 *
 * DATA GAP: There is no referral backend. No referral code, friend count, or
 * earnings exist in the app. Every dynamic value renders as a SlotPlaceholder
 * and Copy / Share are inert until the backend lands. Gap reported to owner.
 */
export function ReferEarnScreen(): React.ReactElement {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

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
            <SlotPlaceholder variant="title20" width={104} />
          </View>
          {/* Copy (298:3813) — not pressable while there is no code */}
          <View style={styles.copyRow}>
            <MiColorIcon name="copy" size={20} />
            <MiText variant="strong15" color="brand">
              Copy
            </MiText>
          </View>
        </View>

        {/* Share Invite Link (298:3816) — disabled until a referral code exists */}
        <MiButton tone="dark" label="Share Invite Link" disabled />

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
              subtitle="They get ₹100 off their first trip"
            />
            <View style={styles.divider} />
            <StepRow index="3" title="You earn ₹100" subtitle="Credited to your MiTow Wallet" />
          </View>
        </View>

        {/* Your rewards (298:3847) */}
        <View style={styles.rewardsCard}>
          <View style={styles.rewardColumn}>
            <MiText variant="bodyS14" color="secondary">
              Friends joined
            </MiText>
            <SlotPlaceholder variant="title20" width={13} />
          </View>
          <View style={styles.rewardDivider} />
          <View style={[styles.rewardColumn, styles.rewardColumnRight]}>
            <MiText variant="bodyS14" color="secondary">
              You earned
            </MiText>
            <SlotPlaceholder variant="title20" width={51} />
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
