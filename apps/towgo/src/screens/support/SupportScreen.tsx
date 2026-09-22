import React from 'react';
import { ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MiButton, MiInfoBanner, MiNavBar, MiScreen, MiSupportCard, mitowLayout } from '@/design';
import type { RootStackParamList } from '@/navigation/types';
import { supportPhoneDisplay } from './support.data';

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

  // PO decision: FAQ / Help Center → HelpCenter; chat → SupportChat (60), report an issue →
  // ReportIssue (61), contact → ContactUs. Share Feedback has no designed screen: ContactUs,
  // provisional.
  const openHelpCenter = () => navigation.navigate('HelpCenter');
  const openContactUs = () => navigation.navigate('ContactUs');
  const openSupportChat = () => navigation.navigate('SupportChat', {});
  const openReportIssue = () => navigation.navigate('ReportIssue', {});

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
            onPress={openSupportChat}
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

        {/* Help banner 254:1211: Info Banner 224:14 with Show chevron = false, the title set in
            MiTow/Title 20, fixed 98. Read as one element, as before. */}
        <MiInfoBanner
          icon="help"
          height={HELP_BANNER_HEIGHT}
          titleVariant="title20"
          title="We're here to help!"
          subtitle="Get quick support or find answers to common questions."
          accessibilityLabel="We're here to help! Get quick support or find answers to common questions."
        />

        <View style={{ gap: OPTIONS_GAP }}>
          <MiSupportCard
            icon="chat"
            title="Chat with Us"
            subtitle="Instant help from our team"
            onPress={openSupportChat}
          />
          <MiSupportCard
            icon="call"
            title="Call Support"
            subtitle={supportPhoneDisplay}
            accessibilityLabel={`Call Support, ${supportPhoneDisplay}`}
            onPress={openContactUs}
          />
          <MiSupportCard
            icon="faq"
            title="FAQs"
            subtitle="Find answers to common questions"
            onPress={openHelpCenter}
          />
          <MiSupportCard
            icon="report-issue"
            title="Report an Issue"
            subtitle="Let us know if something went wrong"
            onPress={openReportIssue}
          />
          <MiSupportCard
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
