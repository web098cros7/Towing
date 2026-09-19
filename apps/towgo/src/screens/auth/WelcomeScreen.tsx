import React, { useCallback } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mitowColors, mitowLayout, MiText, MiTowLockup } from '@/design';
import type { RootStackParamList } from '@/navigation/types';
import { WelcomeButton } from './welcome/WelcomeButton';
import { WELCOME_FOOTER_SLOP_BOTTOM, WelcomeFooter } from './welcome/WelcomeFooter';
import { WelcomeScrim } from './welcome/WelcomeScrim';
import { fixedType } from './welcome/welcomeType';

/**
 * Figma 02 · Welcome (`421:19849`, lockup "Group 2" `421:19926`) in
 * `P7CqHnGxNFOpA6AZN9CXaH`. Every value below is read off the 393 × 852 frame.
 *
 * Z-order as drawn: photo, top scrim, bottom scrim, tagline, Log In, Sign Up,
 * footer, then the lockup above everything. The status bar and home indicator
 * are OS chrome and are not painted.
 *
 * Type is fixed (`fixedType`), as drawn, not rescaled by device width.
 *
 * Figma pins every layer Left/Top on ONE frame size and draws no other, so the
 * distances it does fix are kept from the real screen edges: the lockup top 115.5
 * from the top and the footer bottom 59 from the bottom. The top group (lockup +
 * tagline) hangs from the top and the CTA group (buttons + footer) stands on the
 * bottom, so on an 852-tall screen every layer lands on its frame coordinate and
 * on other heights only the empty photo between the groups grows or shrinks
 * (spec Data gap 4). A real system bar moves a group only when it would come
 * closer than `SYSTEM_BAR_CLEARANCE` to it, which no current phone's status bar
 * does and an Android 3-button navigation bar (48dp) does not either.
 */
const photo = require('@/assets/illustrations/welcome-photo.jpg');

/*
 * The navigator paints the page white under this screen until the photo has
 * decoded. In development (Expo Go) a require()d image is fetched from Metro over
 * the network first, so warm the image cache while Splash is still up. Release
 * builds resolve to a bundled resource (no http URI) that decodes locally, and
 * `Image.prefetch` only accepts a URL, so it is skipped there.
 */
const photoUri = Image.resolveAssetSource(photo)?.uri;
if (photoUri && /^https?:\/\//.test(photoUri)) {
  Image.prefetch(photoUri).catch(() => undefined);
}

/** Top scrim 421:19850: y 0, 393 × 300. */
const TOP_SCRIM_HEIGHT = 300;
/** Bottom scrim 421:19851: y 472, 393 × 380, flush with the frame bottom. */
const BOTTOM_SCRIM_HEIGHT = 380;

/** Lockup top on the frame. */
const LOCKUP_TOP = 115.5;
/** Lockup left edge 110.5 = 86 left of the frame centre (196.5); not centred. */
const LOCKUP_LEFT_OF_CENTRE = 86;
const LOCKUP_WIDTH = 179.446;
const LOCKUP_HEIGHT = 92;
/** Tagline top 212 − lockup top 115.5 (lockup bottom 207.5 + gap 4.5). */
const LOCKUP_TO_TAGLINE_TOP = 96.5;

/** Footer bottom 793 → 59 above the frame bottom (852). */
const FOOTER_BOTTOM = 59;
/** Log In 628–682 → Sign Up 694. */
const BUTTON_GAP = 12;
/** Sign Up bottom 748 → footer top 774. */
const BUTTONS_TO_FOOTER = 26;

/**
 * The least room kept between a drawn group and a real system bar. It equals the
 * footer link's bottom touch slop, so the link's touch area never reaches under
 * a navigation bar.
 */
const SYSTEM_BAR_CLEARANCE = WELCOME_FOOTER_SLOP_BOTTOM;

const taglineType = fixedType('heading18');

export function WelcomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // E7: the board's Flow Arrow 225:121 leads from 02 to 03 · Login.
  const goToLogin = useCallback(() => navigation.navigate('Login'), [navigation]);

  // E8: Figma draws NO destination for Sign Up and none of the 61 screens is a
  // sign-up screen (spec Data gap 1). Until Ehsan decides, it opens 03 · Login,
  // the only path that creates an account today: a number the backend has not
  // seen verifies on 04 and continues to 05 Profile Setup. Unconfirmed product
  // assumption; change only this handler once a destination is designed.
  const goToSignUp = useCallback(() => navigation.navigate('Login'), [navigation]);

  // E9 "Contact Support": product owner decision, every support entry point opens
  // 58 · Support (root route 'Support'). RootNavigator registers Support,
  // HelpCenter and ContactUs in the signed-out stack as well as the signed-in one.
  // No guard: if that registration ever regresses, React Navigation's dev error
  // should surface it instead of the link silently doing nothing.
  const openSupport = useCallback(() => navigation.navigate('Support'), [navigation]);

  const lockupTop = Math.max(LOCKUP_TOP, insets.top + SYSTEM_BAR_CLEARANCE);
  const footerBottom = Math.max(FOOTER_BOTTOM, insets.bottom + SYSTEM_BAR_CLEARANCE);

  return (
    <View style={styles.root}>
      {/* E1: frame image fill, cover, centred. Both dimensions set explicitly so a
          require()d Image never falls back to its intrinsic size. No Android
          fade-in: the design has nothing under the photo to fade from. */}
      <View style={StyleSheet.absoluteFill}>
        <Image
          source={photo}
          resizeMode="cover"
          fadeDuration={0}
          style={styles.photo}
          accessibilityIgnoresInvertColors
          accessibilityLabel="A MiTow tow truck carrying a car on a highway"
        />
      </View>

      {/* E2 */}
      <WelcomeScrim
        id="welcomeTopScrim"
        color="#FFFFFF"
        fromOpacity={0.75}
        toOpacity={0}
        style={styles.topScrim}
      />
      {/* E6 */}
      <WelcomeScrim
        id="welcomeBottomScrim"
        color="#000000"
        fromOpacity={0}
        toOpacity={0.72}
        style={styles.bottomScrim}
      />

      {/* E5: fixed 351-wide box at x 21, 4.5 below the lockup bottom. */}
      <MiText
        variant="heading18"
        color="primary"
        align="center"
        style={[styles.tagline, taglineType, { top: lockupTop + LOCKUP_TO_TAGLINE_TOP }]}
      >
        {'Reliable Towing.\nAnytime. Anywhere.'}
      </MiText>

      <View style={[styles.ctaGroup, { bottom: footerBottom }]}>
        {/* E7 */}
        <WelcomeButton kind="logIn" label="Log In" onPress={goToLogin} />
        {/* E8 */}
        <WelcomeButton kind="signUp" label="Sign Up" onPress={goToSignUp} style={styles.signUp} />
        {/* E9 */}
        <WelcomeFooter onContactSupport={openSupport} style={styles.footer} />
      </View>

      {/* E4: Group 2 sits above the whole screen, left edge 86 left of centre. */}
      <View
        pointerEvents="none"
        style={[styles.lockup, { top: lockupTop, left: width / 2 - LOCKUP_LEFT_OF_CENTRE }]}
      >
        <MiTowLockup artwork="mark" width={LOCKUP_WIDTH} bowlColor="#B5DCFD" inkColor="#000000" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The frame has no solid fill: only the photo.
  root: { flex: 1 },
  photo: { width: '100%', height: '100%' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: TOP_SCRIM_HEIGHT },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: BOTTOM_SCRIM_HEIGHT,
  },
  tagline: {
    position: 'absolute',
    left: mitowLayout.sideMargin,
    right: mitowLayout.sideMargin,
    color: mitowColors.textPrimary,
  },
  ctaGroup: {
    position: 'absolute',
    left: mitowLayout.sideMargin,
    right: mitowLayout.sideMargin,
  },
  signUp: { marginTop: BUTTON_GAP },
  footer: { marginTop: BUTTONS_TO_FOOTER },
  lockup: { position: 'absolute', width: LOCKUP_WIDTH, height: LOCKUP_HEIGHT },
});
