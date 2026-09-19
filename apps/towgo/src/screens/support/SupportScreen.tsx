import React from 'react';
import { ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  MiButton,
  MiColorIcon,
  MiInfoBanner,
  MiLineIcon,
  MiNavBar,
  MiScreen,
  MiText,
  mitowColors,
  mitowLayout,
  mitowRadii,
  mitowShadows,
  type MiColorIconName,
} from '@/design';
import type { RootStackParamList } from '@/navigation/types';
import { supportPhoneDisplay } from './support.data';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Menu Card 253:1137 border: 1.2 border/subtle, stroke INSIDE (no layout space). */
const CARD_BORDER = 1.2;
/** Options column 254:1225 gap. */
const OPTIONS_GAP = 10;
/** Help banner 254:1211: vertical sizing FIXED at 98. */
const HELP_BANNER_HEIGHT = 98;
/** Support promise 254:1313: vertical sizing FIXED at 88. */
const PROMISE_BANNER_HEIGHT = 88;
/** CTA bottom edge sits 34 above the 852 frame bottom. */
const CTA_BOTTOM_GAP = 34;

/**
 * Figma 58 · Support (`253:1196`). ROOT route `Support`: pushed by the Support tab,
 * every Help chip and every "Get Help" button; drawn with a back chevron and no tab bar.
 *
 * Nav bar, Help banner, five Menu Cards and the Support promise scroll; the
 * "Start a Live Chat" CTA is its own layer in Figma and is pinned as a footer.
 */
export function SupportScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  // PO decision: FAQ / Help Center → HelpCenter; chat, report an issue, contact → ContactUs
  // (until 59–61 are rebuilt). Share Feedback has no designed screen: ContactUs, provisional.
  const openHelpCenter = () => navigation.navigate('HelpCenter');
  const openContactUs = () => navigation.navigate('ContactUs');

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            // The foundation's pinned-bottom rule (MiSheetPanel: max(paddingBottom, insets.bottom)):
            // exactly the drawn 34 on iPhone 16 and on Android gesture nav, and never under
            // a taller system navigation bar.
            paddingBottom: Math.max(insets.bottom, CTA_BOTTOM_GAP),
          }}
        >
          {/* Primary Button 224:10: leading icon/message 22 (stroke 2.1), trailing arrow hidden. */}
          <MiButton
            tone="dark"
            label="Start a Live Chat"
            leadingIcon="message"
            leadingIconSize={22}
            onPress={openContactUs}
          />
        </View>
      }
    >
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        // Content 254:1204: padding L/R 21, gap 16, no bottom padding (it ends at the promise).
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
        }}
        showsVerticalScrollIndicator={false}
      >
        <MiNavBar title="Support" onBack={() => navigation.goBack()} />

        <HelpBanner
          title="We're here to help!"
          subtitle="Get quick support or find answers to common questions."
        />

        <View style={{ gap: OPTIONS_GAP }}>
          <SupportCard
            icon="chat"
            title="Chat with Us"
            subtitle="Instant help from our team"
            onPress={openContactUs}
          />
          <SupportCard
            icon="call"
            title="Call Support"
            subtitle={supportPhoneDisplay}
            accessibilityLabel={`Call Support, ${supportPhoneDisplay}`}
            onPress={openContactUs}
          />
          <SupportCard
            icon="faq"
            title="FAQs"
            subtitle="Find answers to common questions"
            onPress={openHelpCenter}
          />
          <SupportCard
            icon="report-issue"
            title="Report an Issue"
            subtitle="Let us know if something went wrong"
            onPress={openContactUs}
          />
          <SupportCard
            icon="feedback"
            title="Share Feedback"
            subtitle="Help us improve your experience"
            onPress={openContactUs}
          />
        </View>

        {/* Info Banner 224:14 as drawn: Strong 15.5 title, Show chevron = false, fixed 88. */}
        <MiInfoBanner
          icon="verified"
          height={PROMISE_BANNER_HEIGHT}
          title="Our Support Promise"
          subtitle="We respond within minutes, 24/7, because your safety matters."
        />
      </ScrollView>
    </MiScreen>
  );
}

/**
 * The Help banner (254:1211): Info Banner 224:14 with Show chevron = false and the
 * title set in MiTow/Title 20. Same geometry as `MiInfoBanner` (fixed height, padding
 * 8/8, gap 8, radius 14, 49 icon, clipping text column); screen-local ONLY because the
 * foundation `MiInfoBanner` hard-codes its title to Strong 15.5 and screen agents cannot
 * edit it. Replace with `MiInfoBanner` once it takes a title variant.
 */
function HelpBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${title} ${subtitle}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: HELP_BANNER_HEIGHT,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: mitowRadii.cardSm,
        backgroundColor: mitowColors.brandYellowSoft,
      }}
    >
      <MiColorIcon name="help" size={49} />
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <MiText variant="title20">{title}</MiText>
        <MiText variant="bodyXS135" color="secondary">
          {subtitle}
        </MiText>
      </View>
    </View>
  );
}

/**
 * Menu Card 253:1137 holding one Menu Row 238:520 (Show chevron = true).
 * The whole 351×66 card is the tap target. The 1.2 border is drawn as an
 * overlay so it takes no layout space, as Figma's INSIDE stroke does.
 */
function SupportCard({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
}: {
  icon: MiColorIconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  return (
    <Pressable
      onPress={onPress}
      pressScale={theme.motion.pressScale.card}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={{
        backgroundColor: mitowColors.surfacePage,
        borderRadius: mitowRadii.cardSm,
        paddingVertical: 5,
        ...mitowShadows.card,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 14,
          paddingRight: 10,
        }}
      >
        <MiColorIcon name={icon} size={34} />
        {/* Text 238:529: gap 1, clips; title and subtitle are each drawn on ONE line, so the
            card keeps its drawn 66. Where a narrower device column cannot hold a line at
            the scaled size, it shrinks to fit rather than wrapping or dropping words. */}
        <View style={{ flex: 1, gap: 1, overflow: 'hidden' }}>
          <MiText variant="bodyM15" numberOfLines={1} ellipsizeMode="clip" adjustsFontSizeToFit>
            {title}
          </MiText>
          <MiText
            variant="bodyS14"
            color="secondary"
            numberOfLines={1}
            ellipsizeMode="clip"
            adjustsFontSizeToFit
          >
            {subtitle}
          </MiText>
        </View>
        {/* icon/chevron-right at 20: MiLineIcon keeps the component's absolute 2.2 stroke. */}
        <MiLineIcon name="chevron-right" size={20} color={mitowColors.textPrimary} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: mitowRadii.cardSm,
          borderWidth: CARD_BORDER,
          borderColor: mitowColors.borderSubtle,
        }}
      />
    </Pressable>
  );
}
