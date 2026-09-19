import React, { useCallback, useRef, useState } from 'react';
import { Alert, Image, Keyboard, View, type LayoutChangeEvent, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import {
  mitowColors,
  mitowLayout,
  mitowRadii,
  mitowShadows,
  MiButton,
  MiScreen,
  MiSegmented,
  MiText,
  MiTowLockup,
} from '@/design';
import { useSendOtp } from '@/features/auth/api/auth.queries';
import type { RootStackParamList } from '@/navigation/types';
import {
  DEFAULT_LOGIN_DIAL_CODE,
  LOGIN_DIAL_CODES,
  type LoginDialCode,
} from './login/dialCodes.data';
import { LoginDialCodeButton } from './login/LoginDialCodeButton';
import { LoginMethodField } from './login/LoginMethodField';
import { LOGIN_METHODS, type LoginMethodKey } from './login/loginMethods.data';
import { boardTagline, useScaledTypeStyle } from './login/loginType';
import { pickDialCode } from './login/pickDialCode';
import { useKeyboardOverlap } from './login/useKeyboardOverlap';

/**
 * Figma 03 · Login (`258:1547`), built from the spec.
 *
 * One static frame: nothing scrolls. The canvas zone (logo, tagline, headline,
 * body, hero) sits in normal flow below the status bar, and the white panel
 * follows 16 below the hero and runs to the bottom edge. On the 393×852 frame
 * that puts the panel top at y392.
 *
 * Two states the design does not draw (spec data gap 7) keep the panel's
 * content reachable without scrolling: on a screen too short for the frame, and
 * while the keyboard is up, the panel moves up over the hero by exactly the
 * missing height.
 */
const heroImage = require('@/assets/illustrations/login-hero.jpg');

/** 2a Logo mark: 13.5 below the status bar, x22.5. */
const LOGO_TOP = 13.5;
const LOGO_LEFT = 22.5;
/** 2b Tagline: 6.5 below the mark, x22. */
const MARK_TO_TAGLINE = 6.5;
const TAGLINE_LEFT = 22;
/** 3 Headline: 16.52 below the tagline. */
const TAGLINE_TO_HEADLINE = 16.52;
/** 4 Body: 6 below the headline, soft-wrapped in a 300 px box. */
const HEADLINE_TO_BODY = 6;
const BODY_WIDTH = 300;
/** 5 Hero slot: 351×133 on the 393 frame, radius 16. */
const HERO_HEIGHT = 133;
/** 6 Panel: top padding 20. */
const PANEL_PAD_TOP = 20;
/** 6.4 "OR" row: 17 tall, gap 12. */
const OR_ROW_HEIGHT = 17;
/** 6.5 Sign-up row: 21.5 below the OR row, gap 6. */
const OR_TO_SIGN_UP = 21.5;
const SIGN_UP_GAP = 6;

const DIGITS_ONLY = /\D/g;

const SEGMENT_OPTIONS = LOGIN_METHODS.map((method) => ({
  key: method.key,
  label: method.segmentLabel,
}));

export function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const Pressable = usePressablePrimitive();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const taglineType = useScaledTypeStyle(boardTagline);

  const [methodKey, setMethodKey] = useState<LoginMethodKey>('mobile');
  const method = LOGIN_METHODS.find((m) => m.key === methodKey) ?? LOGIN_METHODS[0];
  const [dialCode, setDialCode] = useState<LoginDialCode>(DEFAULT_LOGIN_DIAL_CODE);
  const [digits, setDigits] = useState('');
  const [email, setEmail] = useState('');
  const sendOtp = useSendOtp();
  const inputRef = useRef<TextInput | null>(null);

  const mobile = `${dialCode.dialCode}${digits}`;
  // TEMPORARY: any number is accepted so the flow can be walked end to end
  // without a real SMS provider. The real rule is /^[6-9]\d{9}$/ (a valid Indian
  // mobile); restore it before this reaches anyone outside the team.
  const validMobile = digits.length > 0;

  const onChangeDigits = useCallback(
    (value: string) => {
      setDigits(value.replace(DIGITS_ONLY, '').slice(0, dialCode.nationalNumberLength));
    },
    [dialCode.nationalNumberLength],
  );

  const onChangeMethod = useCallback((key: string) => {
    if (key === 'mobile' || key === 'email') setMethodKey(key);
  }, []);

  const onPressDialCode = useCallback(() => {
    void pickDialCode(LOGIN_DIAL_CODES).then((picked) => {
      if (!picked) return;
      setDialCode(picked);
      setDigits((current) => current.slice(0, picked.nationalNumberLength));
    });
  }, []);

  const submit = useCallback(async () => {
    // The design draws Continue at full strength with an empty field and draws
    // no disabled or loading state, so the button always looks the same; an
    // empty field just puts the cursor in it and a second tap while a request
    // is in flight is ignored.
    if (methodKey === 'email') {
      if (!email.trim()) {
        inputRef.current?.focus();
        return;
      }
      // The auth API is phone OTP only (spec data gap 1): there is no email
      // log-in to send this to yet.
      Alert.alert('Email log-in is not available yet', 'Use your mobile number to log in for now.');
      return;
    }
    if (sendOtp.isPending) return;
    if (!validMobile) {
      inputRef.current?.focus();
      return;
    }
    try {
      const res = await sendOtp.mutateAsync(mobile);
      navigation.navigate('VerifyOtp', {
        challengeId: res.challengeId,
        mobile,
        resendAfterSeconds: res.resendAfterSeconds,
      });
    } catch (error) {
      // No inline error state is drawn on 03; the OS alert adds nothing to the
      // screen itself.
      Alert.alert(
        'Could not send the code',
        error instanceof Error ? error.message : 'Something went wrong.',
      );
    }
  }, [email, methodKey, mobile, navigation, sendOtp, validMobile]);

  // Static-frame fit. Heights are measured, not assumed, because the copy
  // scales with `theme.scaleRatio`.
  const frameRef = useRef<View>(null);
  const {
    visible: keyboardVisible,
    overlap: keyboardOverlap,
    onFrameLayout: onKeyboardFrameLayout,
  } = useKeyboardOverlap(frameRef);
  const [frameHeight, setFrameHeight] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [formHeight, setFormHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  const onFrameLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setFrameHeight(event.nativeEvent.layout.height);
      onKeyboardFrameLayout();
    },
    [onKeyboardFrameLayout],
  );

  // What must stay visible inside the panel: everything down to the sign-up row
  // clear of the home indicator / navigation bar; with the keyboard up, the
  // segments, field and Continue clear of the keyboard.
  const panelNeeds =
    PANEL_PAD_TOP +
    formHeight +
    (keyboardVisible
      ? keyboardOverlap + mitowLayout.blockGap
      : footerHeight + Math.max(insets.bottom, mitowLayout.sheetPadBottom));
  const measured = frameHeight > 0 && canvasHeight > 0 && formHeight > 0 && footerHeight > 0;
  const panelMarginTop = measured
    ? Math.max(
        -canvasHeight,
        Math.min(mitowLayout.blockGap, frameHeight - canvasHeight - panelNeeds),
      )
    : mitowLayout.blockGap;

  return (
    <MiScreen backgroundColor={mitowColors.surfaceCanvas} edges={['top']}>
      <View
        ref={frameRef}
        style={{ flex: 1 }}
        onLayout={onFrameLayout}
        // A tap outside the field closes the keyboard (the number pad has no
        // return key). Buttons and the field claim their own taps first.
        onStartShouldSetResponder={() => Keyboard.isVisible()}
        onResponderRelease={() => Keyboard.dismiss()}
      >
        {/* Canvas zone: logo → hero. */}
        <View onLayout={(event) => setCanvasHeight(event.nativeEvent.layout.height)}>
          {/* 2a Logo mark 421:19914: 77 × 39.48. */}
          <View style={{ marginTop: LOGO_TOP, marginLeft: LOGO_LEFT, alignSelf: 'flex-start' }}>
            <MiTowLockup artwork="mark" width={77} bowlColor="#FFFFFF" />
          </View>

          {/* 2b Tagline 259:1750: Board/Tagline, text/secondary. */}
          <MiText
            color="secondary"
            numberOfLines={1}
            style={{ ...taglineType, marginTop: MARK_TO_TAGLINE, marginLeft: TAGLINE_LEFT }}
          >
            {"MOVE. WE'RE THERE."}
          </MiText>

          {/* 3 Headline 259:1751. */}
          <MiText
            variant="display34"
            style={{ marginTop: TAGLINE_TO_HEADLINE, marginLeft: mitowLayout.sideMargin }}
          >
            Welcome Back!
          </MiText>

          {/* 4 Body 259:1752: the 300 box scales with the type so the drawn
              two-line break holds on every device. */}
          <MiText
            variant="bodyL155"
            color="secondary"
            style={{
              marginTop: HEADLINE_TO_BODY,
              marginLeft: mitowLayout.sideMargin,
              width: BODY_WIDTH * theme.scaleRatio,
            }}
          >
            Log in to book a tow, get roadside assistance and manage your trips.
          </MiText>

          {/* 5 Hero 403:19243: image fill, cover-cropped live from the full source. */}
          <View
            style={{
              marginTop: mitowLayout.blockGap,
              marginHorizontal: mitowLayout.sideMargin,
              height: HERO_HEIGHT,
              borderRadius: mitowRadii.image,
              overflow: 'hidden',
            }}
          >
            <Image
              source={heroImage}
              resizeMode="cover"
              style={{ width: '100%', height: '100%' }}
              accessibilityIgnoresInvertColors
              accessible
              accessibilityLabel="A tow truck carrying a car"
            />
          </View>
        </View>

        {/* 6 Login panel 259:1753: white, top radius 24, no border, Elevation/Sheet,
            16 below the hero, runs to the bottom edge. */}
        <View
          style={{
            flexGrow: 1,
            marginTop: panelMarginTop,
            backgroundColor: mitowColors.surfacePage,
            borderTopLeftRadius: mitowRadii.sheet,
            borderTopRightRadius: mitowRadii.sheet,
            ...mitowShadows.sheet,
            paddingTop: PANEL_PAD_TOP,
            paddingHorizontal: mitowLayout.sideMargin,
          }}
        >
          <View onLayout={(event) => setFormHeight(event.nativeEvent.layout.height)}>
            {/* 6.1 Method segmented control 259:1754. */}
            <MiSegmented options={SEGMENT_OPTIONS} value={methodKey} onChange={onChangeMethod} />

            {/* 6.2 Field 259:1759: 16 below. */}
            <View style={{ marginTop: mitowLayout.blockGap }}>
              {methodKey === 'mobile' ? (
                <LoginMethodField
                  key="mobile"
                  method={method}
                  value={digits}
                  onChangeText={onChangeDigits}
                  onSubmit={submit}
                  inputRef={inputRef}
                  maxLength={dialCode.nationalNumberLength}
                  leading={
                    <LoginDialCodeButton dialCode={dialCode.dialCode} onPress={onPressDialCode} />
                  }
                />
              ) : (
                <LoginMethodField
                  key="email"
                  method={method}
                  value={email}
                  onChangeText={setEmail}
                  onSubmit={submit}
                  inputRef={inputRef}
                />
              )}
            </View>

            {/* 6.3 Continue 259:1768: Primary Button, trailing arrow, 16 below. */}
            <MiButton
              label="Continue"
              trailingIcon="arrow-right"
              onPress={submit}
              style={{ marginTop: mitowLayout.blockGap }}
            />
          </View>

          <View
            style={{ paddingTop: mitowLayout.blockGap }}
            onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          >
            {/* 6.4 "OR" row 259:1774: 16 below Continue. */}
            <View
              style={{
                minHeight: OR_ROW_HEIGHT,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View style={{ flex: 1, height: 1, backgroundColor: mitowColors.borderSubtle }} />
              <MiText variant="label13" color="secondary">
                OR
              </MiText>
              <View style={{ flex: 1, height: 1, backgroundColor: mitowColors.borderSubtle }} />
            </View>

            {/* 6.5 Sign-up row 259:1787: centred, items top. */}
            <View
              style={{
                marginTop: OR_TO_SIGN_UP,
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'flex-start',
                gap: SIGN_UP_GAP,
              }}
            >
              <MiText variant="bodyM15" color="secondary">
                {"Don't have an account?"}
              </MiText>
              <Pressable
                // Drawn as a tappable link, but no destination exists in Figma
                // (spec data gap 3): like Home's hamburger, it does nothing yet.
                onPress={() => {}}
                pressScale={theme.motion.pressScale.chip}
                haptic="light"
                hitSlop={12}
                accessibilityRole="link"
                accessibilityLabel="Sign Up"
              >
                <MiText variant="strong15" color="brand">
                  Sign Up
                </MiText>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </MiScreen>
  );
}
