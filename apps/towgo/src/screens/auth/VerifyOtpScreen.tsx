import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive, type OtpInputHandle } from '@towing/ui';
import {
  mitowLayout,
  mitowType,
  MiButton,
  MiColorIcon,
  MiNavBar,
  MiOtpCells,
  MiScreen,
  MiText,
} from '@/design';
import { useSendOtp, useVerifyOtp } from '@/features/auth/api/auth.queries';
import { env } from '@/lib/env';
import { haptics } from '@/motion';
import type { RootStackParamList } from '@/navigation/types';
import { formatIndianMobile } from './verify-otp/formatIndianMobile';
import { LegalDocumentModal } from './verify-otp/LegalDocumentModal';
import type { LegalDocumentKey } from './verify-otp/legalDocuments';
import { useKeyboardStableFrame } from './verify-otp/useKeyboardStableFrame';

/**
 * Figma 04 · Verify OTP (`284:1735`), auth step 2.
 *
 * Its own stack route: Android hardware back pops natively, and unmounting
 * resets both the entered code and the verify mutation state.
 *
 * Built only from what the frame draws. The design has no error, loading,
 * disabled or "resend ready" look, so none is painted here:
 * - Verify stays full-opacity "Verify" at all times. With fewer than 6 digits it
 *   brings the number pad back instead of submitting.
 * - A rejected code clears the cells (cell 1 turns Focused again), plays the
 *   error haptic and is announced to screen readers; no red text or borders are
 *   drawn.
 * - The countdown only ever renders the drawn "Resend code in {n}s" run in
 *   text/placeholder. At 0 it reads "Resend code in 0s" and becomes tappable;
 *   no other copy or colour is drawn for that state.
 */
const OTP_LENGTH = 6;

/** Terms text: 300 wide box at Label 13, bottom edge 29 above the frame bottom. */
const TERMS_WIDTH = 300;
const TERMS_BOTTOM = 29;
/** The drawn gap between the Terms text and the top of the home indicator. */
const TERMS_ABOVE_SYSTEM_BAR = 16;
/** MiText's accessibility font-scale cap. */
const MAX_FONT_SCALE = 1.2;

/** Fallback when the push transition never reports its end. */
const FOCUS_FALLBACK_MS = 1000;

export function VerifyOtpScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'VerifyOtp'>>();
  const Pressable = usePressablePrimitive();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const { frameRef, onFrameLayout, frameHeight, keyboardOverlap } = useKeyboardStableFrame();
  const { mobile } = route.params;

  const [challengeId, setChallengeId] = useState(route.params.challengeId);
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(route.params.resendAfterSeconds);
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentKey>('terms');

  const sendOtp = useSendOtp();
  const verifyOtp = useVerifyOtp();
  const submittedRef = useRef(false);
  const otpRef = useRef<OtpInputHandle>(null);

  /** Written each render below, so echoDevOtp (declared first) reaches onChangeCode. */
  const onChangeCodeRef = useRef<(value: string) => void>(() => {});

  /**
   * DEV ONLY: auto-fill the code from the backend's OTP echo
   * (`GET /v1/auth/dev/otp`, gated server-side by `AUTH_DEV_OTP_ECHO`). Dead
   * outside `__DEV__` unless `EXPO_PUBLIC_DEV_OTP_ECHO` opts a preview build in,
   * and a no-op in mock mode, where the fixed 123456 works. Silent on failure.
   */
  const echoDevOtp = useCallback((forChallenge: string) => {
    if (!(__DEV__ || env.devOtpEcho) || env.useMocks) return;
    setTimeout(() => {
      fetch(`${env.apiBaseUrl}/v1/auth/dev/otp?challengeId=${forChallenge}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { otp?: string } | null) => {
          if (j?.otp) onChangeCodeRef.current(j.otp);
        })
        .catch(() => {});
    }, 600);
  }, []);

  // LoginScreen minted the challenge, so the echo fires on arrival here.
  useEffect(() => {
    echoDevOtp(route.params.challengeId);
  }, [echoDevOtp, route.params.challengeId]);

  /**
   * Bring up the number pad once the push has settled. `autoFocus` during an
   * Android native-stack push often focuses the input without opening the
   * keyboard; focusing after `transitionEnd` does not. The Focused cell is drawn
   * either way (MiOtpCells does not depend on input focus).
   */
  useEffect(() => {
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      otpRef.current?.focus();
    };
    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (!e.data.closing) open();
    });
    const fallback = setTimeout(open, FOCUS_FALLBACK_MS);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  const submit = useCallback(
    async (otp: string) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      try {
        await verifyOtp.mutateAsync({ challengeId, otp });
        // The root navigator swaps to the authenticated stack once authStore flips.
      } catch (err) {
        submittedRef.current = false;
        setCode('');
        haptics.error();
        otpRef.current?.focus();
        AccessibilityInfo.announceForAccessibility(
          err instanceof Error && err.message ? err.message : 'That code was not accepted.',
        );
      }
    },
    [challengeId, verifyOtp],
  );

  // Auto-submit on the 6th digit: `maestro/customer-login.yaml` relies on it.
  const onChangeCode = useCallback(
    (value: string) => {
      setCode(value);
      if (value.length === OTP_LENGTH) submit(value);
    },
    [submit],
  );
  onChangeCodeRef.current = onChangeCode;

  const onVerify = useCallback(() => {
    if (code.length === OTP_LENGTH) submit(code);
    else otpRef.current?.focus();
  }, [code, submit]);

  const canResend = secondsLeft <= 0 && !sendOtp.isPending;

  const resend = useCallback(async () => {
    if (!canResend) return;
    submittedRef.current = false;
    setCode('');
    try {
      const res = await sendOtp.mutateAsync(mobile);
      setChallengeId(res.challengeId);
      setSecondsLeft(res.resendAfterSeconds);
      echoDevOtp(res.challengeId);
    } catch (err) {
      AccessibilityInfo.announceForAccessibility(
        err instanceof Error && err.message ? err.message : 'Could not resend the code.',
      );
    }
  }, [canResend, echoDevOtp, mobile, sendOtp]);

  /**
   * "Terms of Service" / "Privacy Policy". The app's legal screen (route `Legal`)
   * is used wherever the navigator registers it; the signed-out stack that holds
   * this screen does not, so the same documents open in a read-only reader.
   */
  const openLegal = useCallback(
    (document: LegalDocumentKey) => {
      haptics.light();
      if (navigation.getState()?.routeNames?.includes('Legal')) {
        navigation.navigate('Legal');
        return;
      }
      Keyboard.dismiss();
      setLegalDocument(document);
      setLegalOpen(true);
    },
    [navigation],
  );

  const closeLegal = useCallback(() => {
    setLegalOpen(false);
    // After the reader has slid away, put the number pad back.
    setTimeout(() => otpRef.current?.focus(), 350);
  }, []);

  /**
   * iOS: the drawn 29, which is 16 above the home indicator (always 13 from the
   * bottom edge). Android: 16 above the system navigation bar, never less than 29.
   */
  const termsBottom =
    Platform.OS === 'android'
      ? Math.max(TERMS_BOTTOM, insets.bottom + TERMS_ABOVE_SYSTEM_BAR)
      : TERMS_BOTTOM;

  /**
   * The 300 box is drawn for Label 13 at 13px. MiText scales type by the theme
   * ratio (and the OS font scale, capped at 1.2), so the box scales with the
   * rendered size to keep the drawn break: "…our Terms of Service" / "and Privacy
   * Policy".
   */
  const labelSize =
    theme.scaleRatio === 1
      ? mitowType.label13.fontSize
      : Math.round(mitowType.label13.fontSize * theme.scaleRatio * 2) / 2;
  const termsWidth = Math.min(
    TERMS_WIDTH * (labelSize / mitowType.label13.fontSize) * Math.min(fontScale, MAX_FONT_SCALE),
    windowWidth - mitowLayout.sideMargin * 2,
  );

  return (
    <MiScreen edges={['top']}>
      <View ref={frameRef} style={{ flex: 1 }} onLayout={onFrameLayout}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
        >
          <View style={{ flexGrow: 1, minHeight: frameHeight > 0 ? frameHeight : undefined }}>
            {/* Content column 284:1851: side margin 21, gap 16, top-anchored. */}
            <View
              style={{
                paddingHorizontal: mitowLayout.sideMargin,
                gap: mitowLayout.blockGap,
                alignItems: 'stretch',
              }}
            >
              {/* 1. Nav bar, Trailing=None, title " " (no visible title). */}
              <MiNavBar trailing="none" onBack={() => navigation.goBack()} />

              {/* 2. Heading block 284:1858, gap 8. */}
              <View style={{ gap: 8, alignItems: 'flex-start' }}>
                {/* "Enter the code" is `customer-login.yaml`'s step-2 marker. */}
                <MiText
                  variant="display34"
                  color="primary"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  Enter the code
                </MiText>
                {/* Drawn on one line at 351: shrinks to fit rather than wrap. */}
                <MiText
                  variant="bodyL155"
                  color="secondary"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={{ alignSelf: 'stretch' }}
                >
                  {'We sent a 6-digit code to '}
                  <MiText variant="bodyL155" weight="semibold" color="primary">
                    {formatIndianMobile(mobile)}
                  </MiText>
                </MiText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MiText variant="bodyM15" color="secondary" numberOfLines={1}>
                    Wrong number?
                  </MiText>
                  <Pressable
                    onPress={() => navigation.goBack()}
                    pressScale={theme.motion.pressScale.chip}
                    haptic="light"
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Change number"
                  >
                    <MiText variant="strong15" color="brand" numberOfLines={1}>
                      Change
                    </MiText>
                  </Pressable>
                </View>
              </View>

              {/* 3. Code row 284:1864. */}
              <MiOtpCells ref={otpRef} value={code} onChange={onChangeCode} />

              {/* 4. Resend row 284:1883, centred, gap 6. */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <MiText variant="bodyM15" color="secondary" numberOfLines={1}>
                  {"Didn't get it?"}
                </MiText>
                <Pressable
                  onPress={resend}
                  disabled={!canResend}
                  pressScale={theme.motion.pressScale.chip}
                  haptic="light"
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canResend }}
                  accessibilityLabel="Resend code"
                >
                  <MiText variant="strong15" color="placeholder" numberOfLines={1}>
                    {`Resend code in ${secondsLeft}s`}
                  </MiText>
                </Pressable>
              </View>

              {/* 5. Verify, Primary Button 224:10: no icons, always full opacity. */}
              <MiButton tone="dark" label="Verify" onPress={onVerify} />

              {/* 6. Secure note 284:1892, centred, gap 10. */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <MiColorIcon name="verified" size={30} />
                <View style={{ alignItems: 'flex-start' }}>
                  <MiText variant="strong14" color="primary" numberOfLines={1}>
                    Keep this code private
                  </MiText>
                  <MiText variant="label13" color="secondary" numberOfLines={1}>
                    MiTow will never call you to ask for it.
                  </MiText>
                </View>
              </View>
            </View>

            {/* 7. Terms 284:1899: 300 wide, centred, pinned to the bottom of the screen. */}
            <View
              style={{
                marginTop: 'auto',
                paddingTop: mitowLayout.blockGap,
                paddingBottom: termsBottom,
                alignItems: 'center',
              }}
            >
              <MiText
                variant="label13"
                color="secondary"
                align="center"
                style={{ width: termsWidth }}
              >
                {'By continuing, you agree to our '}
                <MiText
                  variant="label13"
                  weight="semibold"
                  color="brand"
                  onPress={() => openLegal('terms')}
                  accessibilityRole="link"
                >
                  Terms of Service
                </MiText>
                {' and '}
                <MiText
                  variant="label13"
                  weight="semibold"
                  color="brand"
                  onPress={() => openLegal('privacy')}
                  accessibilityRole="link"
                >
                  Privacy Policy
                </MiText>
              </MiText>
            </View>
          </View>

          {/* Scroll room for the part of the page the keyboard covers; draws nothing. */}
          {keyboardOverlap > 0 ? <View style={{ height: keyboardOverlap }} /> : null}
        </ScrollView>
      </View>

      <LegalDocumentModal visible={legalOpen} document={legalDocument} onClose={closeLegal} />
    </MiScreen>
  );
}
