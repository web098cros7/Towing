import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Image,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { motion, useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';
import { Logo } from '@/components/Logo';
import { TextField } from '@/components/TextField';
import { OtpInput, type OtpInputHandle } from '@towing/ui';
import { useSendOtp, useVerifyOtp } from '@/features/auth/api/auth.queries';
import { Phone } from '@/icons';
import { env } from '@/lib/env';

/**
 * Login (Figma `38:2`, "Mobile Screen Login V2") — hero art, MiTow logo,
 * Welcome header, then ONE animated form area that steps between phone entry
 * and OTP entry.
 *
 * ONE SCREEN, NOT TWO. This replaced `PhoneEntryScreen` + `OtpScreen`, and the
 * merge is what buys the design's feel: the hero, logo and header never move
 * while the form underneath slides between steps (Material shared-axis X — the
 * exiting pane slides/fades left, the entering one arrives from the right).
 * As two stack screens, the whole page re-entered and the top half visibly
 * repainted on every transition.
 *
 * The design frame has only the password variant of this screen; the OTP step
 * reuses its field/button grammar (52dp controls, radius 12, 24dp gutters) so
 * both steps read as the same screen. Per-product decision: OTP boxes instead
 * of the password field — auth here has no passwords at all (spec §9.1.1).
 */

const DESIGN_WIDTH = 390;
const HERO_WIDTH = 325;
const HERO_HEIGHT = 158;

/**
 * Same two layers as `HomeHero`, but COINCIDENT — the login design bakes truck
 * and skyline into one 325×158 block (`image 6`), unlike Home where the
 * skyline is offset for depth. Reusing the assets keeps the APK free of a
 * third copy of the same artwork.
 */
const truckImage = require('@/assets/illustrations/hero-truck.png');
const skylineImage = require('@/assets/illustrations/hero-skyline.png');

const DIGITS_ONLY = /\D/g;
const OTP_LENGTH = 6;

/** Both panes' content fits inside this; the taller (OTP) pane sets it. */
const FORM_HEIGHT = 288;

type Step = 'phone' | 'otp';

export function LoginScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const scale = Math.min(width / DESIGN_WIDTH, 1.15);

  const [step, setStep] = useState<Step>('phone');
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);

  const sendOtp = useSendOtp();
  const verifyOtp = useVerifyOtp();
  const submittedRef = useRef(false);
  const otpRef = useRef<OtpInputHandle>(null);

  /** 0 = phone pane, 1 = OTP pane. Drives both panes' opacity + translateX. */
  const progress = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback(
    (to: Step) => {
      setStep(to);
      Animated.timing(progress, {
        toValue: to === 'otp' ? 1 : 0,
        duration: motion.duration.slow,
        easing: Easing.bezier(...motion.easing.standard),
        useNativeDriver: true,
      }).start();
      if (to === 'otp') {
        // Focus once the pane is inbound; a delay past the fade-in midpoint
        // keeps the keyboard from popping while the phone pane is still visible.
        setTimeout(() => otpRef.current?.focus(), motion.duration.fast);
      }
    },
    [progress],
  );

  const mobile = `+91${digits}`;

  /** Written each render below — lets echoDevOtp (declared first) reach onChangeCode. */
  const onChangeCodeRef = useRef<(value: string) => void>(() => {});

  /**
   * DEV ONLY — auto-fill the code from the backend's OTP echo.
   *
   * Against a real backend with no SMS provider (SETUP-CHECKLIST item 2, MSG91
   * unpurchased), the code is never delivered to the handset — it only exists
   * in the server's logs. The backend exposes `GET /v1/auth/dev/otp` for this
   * exact situation, gated three ways server-side (404s unless
   * `AUTH_DEV_OTP_ECHO`, the adapter only records under the same flag, and
   * production refuses to boot with it set). Client-side this is additionally
   * dead code outside `__DEV__` and does nothing in mock mode, where the fixed
   * 123456 already works. `env.devOtpEcho` (EXPO_PUBLIC_DEV_OTP_ECHO) extends it
   * to the preview EAS environment, where __DEV__ is false.
   *
   * The 600ms delay lets the pane transition land so the boxes visibly fill;
   * filling all six auto-submits, so a dev login is: number → Send OTP → done.
   * Silent on any failure — a 404 just means the server flag is off, and the
   * user types the code from the server logs instead.
   */
  const echoDevOtp = useCallback(
    (forChallenge: string) => {
      // __DEV__ always; a release build only when its EAS environment opts in.
      if (!(__DEV__ || env.devOtpEcho) || env.useMocks) return;
      setTimeout(() => {
        fetch(`${env.apiBaseUrl}/v1/auth/dev/otp?challengeId=${forChallenge}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j: { otp?: string } | null) => {
            if (j?.otp) onChangeCodeRef.current(j.otp);
          })
          .catch(() => {});
      }, 600);
    },
    [],
  );

  // ---- phone step -----------------------------------------------------------

  const onChangeDigits = useCallback((value: string) => {
    setDigits(value.replace(DIGITS_ONLY, '').slice(0, 10));
  }, []);

  const requestOtp = useCallback(async () => {
    try {
      const res = await sendOtp.mutateAsync(mobile);
      setChallengeId(res.challengeId);
      setSecondsLeft(res.resendAfterSeconds);
      submittedRef.current = false;
      setCode('');
      animateTo('otp');
      echoDevOtp(res.challengeId);
    } catch {
      // Surfaced inline below via sendOtp.error.
    }
  }, [animateTo, echoDevOtp, mobile, sendOtp]);

  const validMobile = /^[6-9]\d{9}$/.test(digits);

  // ---- OTP step -------------------------------------------------------------

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
        // Root navigator swaps to the authenticated stack once authStore flips.
      } catch {
        submittedRef.current = false;
      }
    },
    [challengeId, verifyOtp],
  );

  const onChangeCode = useCallback(
    (value: string) => {
      setCode(value);
      if (value.length === OTP_LENGTH) submit(value);
    },
    [submit],
  );
  onChangeCodeRef.current = onChangeCode;

  const resend = useCallback(async () => {
    if (secondsLeft > 0 || sendOtp.isPending) return;
    submittedRef.current = false;
    setCode('');
    const res = await sendOtp.mutateAsync(mobile);
    setChallengeId(res.challengeId);
    setSecondsLeft(res.resendAfterSeconds);
    echoDevOtp(res.challengeId);
  }, [echoDevOtp, mobile, secondsLeft, sendOtp]);

  const backToPhone = useCallback(() => {
    setCode('');
    submittedRef.current = false;
    verifyOtp.reset();
    animateTo('phone');
  }, [animateTo, verifyOtp]);

  // Hardware back on the OTP step returns to the phone step instead of
  // backgrounding the app — the exact behaviour the old two-screen stack had.
  useEffect(() => {
    if (step !== 'otp') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      backToPhone();
      return true;
    });
    return () => sub.remove();
  }, [backToPhone, step]);

  // ---- shared-axis pane styles ---------------------------------------------

  const phonePaneStyle = {
    opacity: progress.interpolate({
      inputRange: [0, 0.5],
      outputRange: [1, 0],
      extrapolate: 'clamp' as const,
    }),
    transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -64] }) }],
  };
  const otpPaneStyle = {
    opacity: progress.interpolate({
      inputRange: [0.5, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp' as const,
    }),
    transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [64, 0] }) }],
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Hero — truck over skyline, centered, scaled off the 390 design frame. */}
      <View style={{ alignItems: 'center', paddingTop: 40 }}>
        <View style={{ width: HERO_WIDTH * scale, height: HERO_HEIGHT * scale }}>
          <Image
            source={skylineImage}
            resizeMode="contain"
            style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.52 }}
            accessibilityIgnoresInvertColors
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Image
            source={truckImage}
            resizeMode="contain"
            style={{ width: '100%', height: '100%' }}
            accessibilityIgnoresInvertColors
            accessibilityLabel="Tow truck loading a car"
          />
        </View>

        <View style={{ alignItems: 'center', paddingTop: 4, gap: 4 }}>
          <Logo width={150 * scale} />
          <Text
            color="tertiary"
            style={{ fontSize: 8, lineHeight: 12, letterSpacing: 1.6 }}
            uppercase
          >
            Towing. Fast. Reliable.
          </Text>
        </View>

        <View style={{ alignItems: 'center', paddingTop: 20, gap: 6 }}>
          <Text weight="semibold" style={{ fontSize: 22, lineHeight: 28, letterSpacing: -0.55 }}>
            Welcome
          </Text>
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 19.5 }}>
            Login to continue and book your tow.
          </Text>
        </View>
      </View>

      {/* Animated form area. Both panes stay mounted so they can crossfade. */}
      <View style={{ height: FORM_HEIGHT, marginTop: 24 }}>
        <Animated.View
          pointerEvents={step === 'phone' ? 'auto' : 'none'}
          style={[
            { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24, gap: 14 },
            phonePaneStyle,
          ]}
        >
          <TextField
            label="Mobile Number"
            value={digits}
            onChangeText={onChangeDigits}
            keyboardType="number-pad"
            placeholder="Enter mobile number"
            leftSlot={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Phone size={17} color={theme.colors.textTertiary} />
                <Text style={{ fontSize: 14, lineHeight: 20 }}>+91</Text>
                <View style={{ width: 1, height: 22, backgroundColor: theme.colors.border }} />
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
            disabled={!validMobile || sendOtp.isPending}
            loading={sendOtp.isPending}
            onPress={requestOtp}
          />

          {env.googleSignInEnabled ? (
            <Button label="Continue with Google" variant="ghost" fullWidth onPress={() => {}} />
          ) : null}
        </Animated.View>

        <Animated.View
          pointerEvents={step === 'otp' ? 'auto' : 'none'}
          style={[
            { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24, gap: 14 },
            otpPaneStyle,
          ]}
        >
          <View style={{ gap: 4 }}>
            {/* "Enter the code" is `customer-login.yaml`'s step-2 marker. */}
            <Text weight="medium" style={{ fontSize: 13, lineHeight: 17, color: theme.colors.textSecondary }}>
              Enter the code
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text color="secondary" style={{ fontSize: 13, lineHeight: 19.5 }}>
                Sent to {mobile}
              </Text>
              <Pressable onPress={backToPhone} hitSlop={8} accessibilityRole="button">
                <Text color="brand" weight="medium" style={{ fontSize: 13, lineHeight: 19.5 }}>
                  Change
                </Text>
              </Pressable>
            </View>
          </View>

          <OtpInput ref={otpRef} value={code} onChange={onChangeCode} error={verifyOtp.isError} />

          {verifyOtp.isError ? (
            <Text color="error" style={{ fontSize: 13 }}>
              {verifyOtp.error instanceof Error
                ? verifyOtp.error.message
                : 'That code was not accepted.'}
            </Text>
          ) : null}

          <Button
            label="Verify"
            fullWidth
            disabled={code.length !== OTP_LENGTH || verifyOtp.isPending}
            loading={verifyOtp.isPending}
            onPress={() => submit(code)}
          />

          <Button
            label={secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
            variant="ghost"
            fullWidth
            disabled={secondsLeft > 0 || sendOtp.isPending}
            loading={step === 'otp' && sendOtp.isPending}
            onPress={resend}
          />
        </Animated.View>
      </View>

      {/*
        Legal footer, per the design. Deliberately NOT links yet: LegalScreen
        lives in the authenticated stack, so there is nothing to navigate to
        from here — and a link that goes nowhere is worse than styled text.
        The DPDP consent overlay after first login is where agreement is
        actually captured.
      */}
      <View style={{ marginTop: 'auto', paddingHorizontal: 24, paddingTop: 24 }}>
        <Text align="center" style={{ fontSize: 10, lineHeight: 16.5 }} color="secondary">
          By continuing, you agree to our{' '}
          <Text color="brand" style={{ fontSize: 10, lineHeight: 16.5, textDecorationLine: 'underline' }}>
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text color="brand" style={{ fontSize: 10, lineHeight: 16.5, textDecorationLine: 'underline' }}>
            Privacy Policy
          </Text>
        </Text>
      </View>
    </ScrollView>
  );
}
