import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mitowColors, mitowLayout, mitowRadii, MiIllustration } from '@/design';
import { haptics } from '@/motion';
import { storage } from '@/lib/storage/storage';
import { useRecordConsent } from '@/features/account/api/privacy.queries';
import { POLICY_VERSION } from '@/lib/legal/policyVersion';
import { AgreeButton } from './consent/AgreeButton';
import { ExactText } from './consent/ExactText';
import { UsageCard, type UsageRow } from './consent/UsageCard';
import { useLegalDetour } from './consent/useLegalDetour';

const CONSENT_FLAG_KEY = 'consent.captured.v1';

/** Gates `ConsentCaptureOverlay` to once per device, read at boot by `RootNavigator`. */
export function hasCapturedConsent(): boolean {
  return storage.getString(CONSENT_FLAG_KEY) === 'true';
}

/**
 * ILL-05 · Your data, protected (403:19245): the Figma image fill itself, the
 * 2048×1152 source PNG (SHA-1 0f035ac1…, the Figma image hash), drawn cover.
 */
const heroImage = require('./consent/ill05-data-protected.png');

/** Figma 06 frame geometry (287:1780) that has no token. */
const CONTENT_PAD_TOP = 13; // Content column 287:1940 padding-top
const HEADING_GAP = 8; // Heading frame 287:1945
const FOOTER_GAP = 12; // I Agree bottom (785) → note top (797)
const HOME_INDICATOR_ZONE = 34; // 852 − 818
const NOTE_ABOVE_INDICATOR = 4; // note bottom 814 = 818 − 4
const NOTE_HEIGHT = 17; // Withdraw note 287:2016 box
/** Illustration top, y 62 = content column y 49 + padding 13. */
const ILLUSTRATION_TOP = mitowLayout.contentTop + CONTENT_PAD_TOP;

/**
 * How long the native stack takes to push `Legal` (ios_from_right: UIKit's push
 * on iOS, `config_shortAnimTime` 200ms on Android), plus a frame or two. The
 * consent Modal stays up until then so the push happens out of sight and the
 * detour is a cut, with no Home flash and no Modal animation.
 */
const LEGAL_PUSH_SETTLE_MS = Platform.OS === 'ios' ? 400 : 250;

/** E4b rows R1–R3 (287:1951, 287:1969, 287:1987): static copy, no chevrons. */
const USAGE_ROWS: readonly UsageRow[] = [
  { icon: 'map', title: 'Your location', subtitle: 'To send the nearest tow truck' },
  { icon: 'call', title: 'Your phone number', subtitle: 'So your driver can reach you' },
  { icon: 'car', title: 'Your vehicle details', subtitle: 'To match the right tow truck' },
];

/**
 * Figma 06 · Consent (287:1780). One-time DPDP consent: "I Agree" records both
 * `privacy_policy` and `terms_of_service` via `POST /me/consent`, sets the
 * per-device flag and hands back to RootNavigator (which then shows 07 over Home).
 *
 * Rendered by RootNavigator as a sibling of the NavigationContainer, so the two
 * policy links reach Privacy & Legal (route `Legal`) through `useLegalDetour`.
 *
 * Geometry, drawn at 393×852 with nothing scrolling:
 * - Type is the Figma styles' exact metrics (`ExactText`), not viewport-scaled.
 * - The illustration top is y 62 (column y 49 + padding 13) on every device; it
 *   only moves down when the system status area itself reaches past y 62.
 * - "I Agree" and the note are fixed at the bottom: the note ends 4 above the
 *   34pt home-indicator zone (y 814, so I Agree sits at y 731). Where the system
 *   navigation area is taller than 34 (Android 3-button nav), the same 4pt gap
 *   is kept above it so the note is never drawn under the system buttons.
 * - The content column never scrolls when it fits above the CTA, which it does
 *   at 852 and taller. Only on a phone too short for the drawn column does the
 *   column (never the CTA or note) become scrollable, so nothing is cut off.
 * - The Modal has no animation, in or out: Figma draws no transition.
 */
export function ConsentCaptureOverlay({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const recordConsent = useRecordConsent();
  const { away, openLegal } = useLegalDetour();
  const [hidden, setHidden] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const submitting = useRef(false);

  // Hide only once `Legal` is fully pushed underneath; show again the moment the
  // customer leaves it (the Legal pop then happens under the Modal).
  useEffect(() => {
    if (!away) {
      setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), LEGAL_PUSH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [away]);

  const agree = async () => {
    // Figma draws no loading state, so a second tap is ignored rather than
    // swapping the label for a spinner.
    if (submitting.current) return;
    submitting.current = true;
    try {
      await Promise.all([
        recordConsent.mutateAsync({ policyType: 'privacy_policy', policyVersion: POLICY_VERSION }),
        recordConsent.mutateAsync({
          policyType: 'terms_of_service',
          policyVersion: POLICY_VERSION,
        }),
      ]);
    } catch {
      // Best-effort: DPDP requires offering consent capture, not permanently
      // locking the app out of use if a single write happens to fail.
    } finally {
      storage.set(CONSENT_FLAG_KEY, 'true');
      onDone();
    }
  };

  const onPolicyLink = () => {
    // The inline spans cannot take a press scale, so the app's light haptic is
    // their only press feedback.
    haptics.light();
    openLegal();
  };

  const illustrationTop = Math.max(ILLUSTRATION_TOP, insets.top);
  const noteBottom = Math.max(HOME_INDICATOR_ZONE, insets.bottom) + NOTE_ABOVE_INDICATOR;
  const columnOverflows = viewportHeight > 0 && contentHeight > viewportHeight + 0.5;

  return (
    <Modal
      visible={!hidden}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // Consent cannot be skipped: Android back does nothing here.
      onRequestClose={() => {}}
    >
      {/* The page is always white: dark status-bar content, also inside the
          Modal's own Android window. */}
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: mitowColors.surfacePage, paddingTop: insets.top }}>
        <ScrollView
          style={{ flex: 1 }}
          scrollEnabled={columnOverflows}
          onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_, height) => setContentHeight(height)}
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
          overScrollMode="never"
          contentContainerStyle={{
            paddingTop: illustrationTop - insets.top,
            paddingHorizontal: mitowLayout.sideMargin,
            gap: mitowLayout.blockGap,
          }}
        >
          {/* E2 ILL-05 · Your data, protected (403:19245), 351×197, radius 16 */}
          <MiIllustration
            source={heroImage}
            aspectRatio={351 / 197}
            radius={mitowRadii.image}
            accessibilityLabel="A phone protected by a shield"
          />

          {/* E3 Heading block (287:1945) */}
          <View style={{ gap: HEADING_GAP }}>
            {/* "Before you continue" is a Maestro marker; do not reword. */}
            <ExactText variant="display34" accessibilityRole="header">
              Before you continue
            </ExactText>
            <ExactText variant="bodyL155" color="secondary">
              {"By continuing, you agree to MiTow's "}
              <ExactText
                variant="bodyL155"
                weight="semibold"
                color="brand"
                onPress={onPolicyLink}
                accessibilityRole="link"
                suppressHighlighting
              >
                Privacy Policy
              </ExactText>
              {' and '}
              <ExactText
                variant="bodyL155"
                weight="semibold"
                color="brand"
                onPress={onPolicyLink}
                accessibilityRole="link"
                suppressHighlighting
              >
                Terms of Service
              </ExactText>
              {
                ', and consent to how we handle your data under the Digital Personal Data Protection Act, 2023.'
              }
            </ExactText>
          </View>

          {/* E4 What we use (287:1948) */}
          <View style={{ gap: mitowLayout.headingGap }}>
            <ExactText variant="heading18" accessibilityRole="header">
              What we use and why
            </ExactText>
            <UsageCard rows={USAGE_ROWS} />
          </View>
        </ScrollView>

        {/* E5 I Agree (287:2010) + E6 Withdraw note (287:2016), fixed at the bottom */}
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: noteBottom,
            gap: FOOTER_GAP,
          }}
        >
          {/* "I Agree" is a Maestro marker; do not reword. */}
          <AgreeButton label="I Agree" onPress={agree} />
          <ExactText
            variant="label13"
            color="secondary"
            align="center"
            style={{ minHeight: NOTE_HEIGHT }}
          >
            You can withdraw consent anytime from Settings.
          </ExactText>
        </View>
      </View>
    </Modal>
  );
}
