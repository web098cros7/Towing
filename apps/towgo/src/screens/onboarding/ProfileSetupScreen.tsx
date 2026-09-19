import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, View, type TextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { mitowColors, mitowLayout, MiButton, MiIllustration, MiText } from '@/design';
import { apiFetch } from '@/lib/api/client';
import { env } from '@/lib/env';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { RootStackParamList } from '@/navigation/types';
import { FullNameField } from './profile-setup/FullNameField';

/**
 * Figma 05 · Profile Setup — screen frame `284:1759` on board `234:346`.
 *
 * Mounted by RootNavigator only while `identity.isNew === true` (right after
 * OTP verify). Continue saves the name (`PUT /me`, skipped in mock mode) and
 * flips `isNew` to false, which moves the root switch on to Tabs, where the
 * consent overlay (06) opens.
 *
 * Layout, from the frame (393×852, nothing scrolls or moves, all pinned Left/Top):
 * - Content column at y 49, 1 above the drawn 50pt status bar's bottom: the real
 *   inset − 1, never higher than the drawn 49. Padding 13 top, 21 sides, gap 16.
 * - Illustration 351×190 (radius 16) → heading block (gap 8) → Full Name field
 *   → later note.
 * - Continue: 351×54 with its bottom edge 43 above the frame bottom (the
 *   iPhone 16 bottom inset 34 + 9), never less than 43 on any device.
 * - No keyboard layout is drawn, so nothing moves when it opens: Continue stays
 *   where it is drawn (the return key submits too). The ScrollView never moves
 *   while everything fits, as drawn; it only lets a shorter phone reach Continue.
 *
 * The Full Name value is the customer's own typing. It starts from the signed-in
 * identity's name (e.g. a Google sign-up), otherwise empty: the Text Field's
 * Default state with its "Enter your full name" placeholder.
 *
 * States Figma does not draw, resolved with the components' own variants only
 * and no copy the design does not contain:
 * - Empty name: Continue stays drawn as designed (Primary Button has no disabled
 *   variant); pressing it puts the field in its Error variant (1.5 status/danger
 *   ring, helper hidden as on this instance) and focuses it.
 * - Saving: no loading variant, so the button keeps its label and repeat presses
 *   are ignored.
 * - Save failure: the same Error ring; the server's message is announced to
 *   screen readers only. Typing clears it.
 */
const heroImage = require('@/assets/illustrations/say-hello.jpg');

/** Figma: Continue's bottom edge sits 43 above the 852 frame bottom. */
const BUTTON_BOTTOM_GAP = 43;
/** 43 − the iPhone 16 home-indicator inset (34). */
const BUTTON_ABOVE_INSET = 9;
/** Content column y 49 is 1 above the drawn status bar's bottom edge (50). */
const STATUS_BAR_OVERLAP = 1;
/** Content column padding-top (no token). */
const CONTENT_PAD_TOP = 13;
/** Heading block gap (no token; `headingGap` is 12). */
const HEADING_GAP = 8;
/**
 * Backstop for the drawn Focused state: Android often drops `autoFocus` while a
 * navigator mounts the screen, and a replaced root screen may not report
 * `transitionEnd`.
 */
const FOCUS_RETRY_MS = 600;

export function ProfileSetupScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'ProfileSetup'>>();
  const insets = useSafeAreaInsets();
  const storedName = useAuthStore((s) => s.identity?.name);
  const updateIdentity = useAuthStore((s) => s.updateIdentity);
  const [name, setName] = useState(() => storedName?.trim() ?? '');
  const [invalid, setInvalid] = useState(false);
  const savingRef = useRef(false);
  const inputRef = useRef<TextInput | null>(null);

  // The screen is drawn Focused (1.5 brand/yellow ring). Retry the focus once the
  // push settles, in case `autoFocus` did not take.
  useEffect(() => {
    const focusField = () => {
      if (inputRef.current && !inputRef.current.isFocused()) inputRef.current.focus();
    };
    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (!e.data.closing) focusField();
    });
    const timer = setTimeout(focusField, FOCUS_RETRY_MS);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [navigation]);

  const onChangeName = useCallback((value: string) => {
    setName(value);
    setInvalid(false);
  }, []);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setInvalid(false);
    try {
      // This screen talks to `apiFetch` directly rather than through a feature
      // data source, so it has no mock path of its own. Without this guard the
      // PUT fails with mocks on and the flow dead-ends here.
      if (!env.useMocks) {
        await apiFetch('me', { method: 'PUT', body: JSON.stringify({ name: trimmed }) });
      }
      // isNew flips to false locally and the root switch re-renders past this
      // screen. `updateIdentity` reads the current tokens from the store itself,
      // so a token pair rotated by a 401 refresh inside apiFetch is not lost.
      updateIdentity({ name: trimmed, isNew: false });
    } catch (e) {
      setInvalid(true);
      if (e instanceof Error && e.message) AccessibilityInfo.announceForAccessibility(e.message);
    } finally {
      savingRef.current = false;
    }
  }, [name, updateIdentity]);

  const contentTop = Math.max(mitowLayout.contentTop, insets.top - STATUS_BAR_OVERLAP);

  return (
    <View style={{ flex: 1, backgroundColor: mitowColors.surfacePage }}>
      <StatusBar style="dark" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
      >
        {/* E1 Content column (284:1900) */}
        <View
          style={{
            paddingTop: contentTop + CONTENT_PAD_TOP,
            paddingHorizontal: mitowLayout.sideMargin,
            gap: mitowLayout.blockGap,
          }}
        >
          {/* E2 ILL-04 · Say hello (403:19244), 351×190, radius 16 */}
          <MiIllustration source={heroImage} aspectRatio={351 / 190} />

          {/* E3 Heading (284:1903) */}
          <View style={{ gap: HEADING_GAP }}>
            <MiText variant="display31" accessibilityRole="header">
              {'What should we\ncall you?'}
            </MiText>
            <MiText variant="bodyL155" color="secondary">
              Your driver will see this name when they arrive.
            </MiText>
          </View>

          {/* E4 Full name field (284:1906): Focused on open */}
          <FullNameField
            label="Full Name"
            placeholder="Enter your full name"
            value={name}
            onChangeText={onChangeName}
            error={invalid}
            inputRef={inputRef}
            onSubmitEditing={save}
            autoFocus
          />

          {/* E5 Later note (284:1918) */}
          <MiText variant="bodyS14" color="secondary">
            You can add your email, vehicles and saved places later from Profile.
          </MiText>
        </View>

        {/* Empty space down to Continue (231 at 852). */}
        <View style={{ flexGrow: 1, minHeight: mitowLayout.blockGap }} />

        {/* E6 Continue (284:1919) */}
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(BUTTON_BOTTOM_GAP, insets.bottom + BUTTON_ABOVE_INSET),
          }}
        >
          <MiButton label="Continue" trailingIcon="arrow-right" onPress={save} />
        </View>
      </ScrollView>
    </View>
  );
}
