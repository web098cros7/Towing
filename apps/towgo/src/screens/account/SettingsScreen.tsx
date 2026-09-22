import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { usePressablePrimitive } from '@towing/ui';
import { useTheme } from '@towing/theme';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiMenuCard,
  MiMenuRow,
  MiButton,
  MiSheet,
  MiOptionRow,
} from '@/design';
import { useVehicles } from '@/features/account/api/vehicles.queries';
import { useEmergencyContacts } from '@/features/account/api/emergencyContacts.queries';
import { useProfile, useUpdateProfile } from '@/features/account/api/profile.queries';
import { storage } from '@/lib/storage/storage';
import type { RootStackParamList } from '@/navigation/types';
import { AppearanceSheet, type AppearanceChoice } from './AppearanceSheet';

// Figma 54 · Language (301:4063) — Settings screen
// Figma 301:4334 — Language bottom sheet
// Figma 55 · Appearance (301:4427) — Appearance bottom sheet

const LANGUAGES = [
  { code: 'en', native: 'English', english: 'English (India)' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
] as const;

type LanguageCode = (typeof LANGUAGES)[number]['code'];

const LANGUAGE_KEY = 'pref.language';
const APPEARANCE_KEY = 'pref.appearance';

function readSavedLanguage(): LanguageCode {
  const raw = storage.getString(LANGUAGE_KEY);
  if (raw === 'en' || raw === 'hi' || raw === 'kn' || raw === 'ta' || raw === 'te') {
    return raw;
  }
  return 'en';
}

function readSavedAppearance(): AppearanceChoice {
  const raw = storage.getString(APPEARANCE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return 'light';
}

const APPEARANCE_LABELS: Record<AppearanceChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const Pressable = usePressablePrimitive();

  const vehiclesQuery = useVehicles();
  const contactsQuery = useEmergencyContacts();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();

  const [language, setLanguage] = useState<LanguageCode>(() => readSavedLanguage());
  const [draft, setDraft] = useState<LanguageCode>(language);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [appearance, setAppearance] = useState<AppearanceChoice>(() => readSavedAppearance());
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // The profile's saved values win when they arrive; MMKV stays as the offline
  // cache. A null on the profile means "unset", so the cache's value stands.
  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    // Figma 54 lists five languages; a server value outside them keeps the cached choice.
    const saved = LANGUAGES.find((l) => l.code === profile.language)?.code;
    if (saved) {
      setLanguage(saved);
      storage.set(LANGUAGE_KEY, saved);
    }
    if (profile.appearance) {
      setAppearance(profile.appearance);
      storage.set(APPEARANCE_KEY, profile.appearance);
    }
  }, [profileQuery.data]);

  const openSheet = useCallback(() => {
    setDraft(language);
    setSheetOpen(true);
  }, [language]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  // The app text stays English until translations exist (reported). The choice is
  // saved to the account; a failed save is silent (the cache keeps the choice and
  // the next Done retries).
  const doneSheet = useCallback(() => {
    storage.set(LANGUAGE_KEY, draft);
    setLanguage(draft);
    setSheetOpen(false);
    updateProfile.mutate({ language: draft });
  }, [draft, updateProfile]);

  const vehiclesCount = vehiclesQuery.data?.length ?? null;
  const contactsCount = contactsQuery.data?.length ?? null;

  const vehiclesSubtitle =
    vehiclesCount === null
      ? null
      : vehiclesCount === 0
        ? 'No vehicles saved'
        : vehiclesCount === 1
          ? '1 vehicle saved'
          : `${vehiclesCount} vehicles saved`;

  const contactsSubtitle =
    contactsCount === null
      ? null
      : contactsCount === 0
        ? 'Alerted during SOS'
        : contactsCount === 1
          ? '1 contact · alerted during SOS'
          : `${contactsCount} contacts · alerted during SOS`;

  const currentLanguage = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <MiScreen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 21,
          gap: 16,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
        showsVerticalScrollIndicator={false}
      >
        <MiNavBar title="Settings" trailing="none" onBack={() => navigation.goBack()} />

        {/* Account 301:4302 */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">Account</MiText>
          <MiMenuCard radius={16} paddingVertical={4}>
            <MiMenuRow
              icon={{ color: 'user' }}
              title="Personal Information"
              subtitle="Name, phone number and email"
              showChevron
              onPress={() => navigation.navigate('PersonalInformation')}
            />
            <MiMenuRow
              icon={{ color: 'car' }}
              title="My Vehicles"
              subtitle={vehiclesSubtitle}
              subtitleSlotWidth={120}
              showChevron
              onPress={() => navigation.navigate('MyVehicles')}
            />
            <MiMenuRow
              icon={{ color: 'contact-alert' }}
              title="Emergency Contacts"
              subtitle={contactsSubtitle}
              subtitleSlotWidth={200}
              showChevron
              onPress={() => navigation.navigate('EmergencyContacts')}
            />
          </MiMenuCard>
        </View>

        {/* Preferences 301:4312 */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">Preferences</MiText>
          <MiMenuCard radius={16} paddingVertical={4}>
            <MiMenuRow
              icon={{ color: 'bell' }}
              title="Notifications"
              subtitle="Booking updates and offers"
              showChevron
              onPress={() => navigation.navigate('NotificationsSettings')}
            />
            <MiMenuRow
              icon={{ color: 'globe' }}
              title="Language"
              trailing={
                <MiText variant="bodyM15" color="secondary">
                  {currentLanguage.native}
                </MiText>
              }
              showChevron
              onPress={openSheet}
            />
            <MiMenuRow
              icon={{ color: 'appearance' }}
              title="Appearance"
              trailing={
                <MiText variant="bodyM15" color="secondary">
                  {APPEARANCE_LABELS[appearance]}
                </MiText>
              }
              showChevron
              onPress={() => setAppearanceOpen(true)}
            />
          </MiMenuCard>
        </View>

        {/* Privacy & Legal 301:4322 */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">Privacy & Legal</MiText>
          <MiMenuCard radius={16} paddingVertical={4}>
            <MiMenuRow
              icon={{ color: 'lock' }}
              title="Privacy Policy"
              showChevron
              onPress={() => navigation.navigate('Legal')}
            />
            <MiMenuRow
              icon={{ color: 'document' }}
              title="Terms of Service"
              showChevron
              onPress={() => navigation.navigate('Legal')}
            />
            <MiMenuRow
              icon={{ color: 'user-shield' }}
              title="Your Data & Account"
              subtitle="Download or delete your data"
              showChevron
              onPress={() => navigation.navigate('Legal')}
            />
          </MiMenuCard>
        </View>

        {/* App version 301:4332 */}
        <MiText variant="label13" color="secondary" align="center">
          {`MiTow v${version}`}
        </MiText>
      </ScrollView>

      {/* Language sheet 301:4334 */}
      <MiSheet
        visible={sheetOpen}
        onClose={closeSheet}
        onBackdropPress={closeSheet}
        accessibilityLabel="Choose language"
      >
        {/* Heading 301:4337 */}
        <View style={{ gap: 4 }}>
          <MiText variant="title23">Choose language</MiText>
          <MiText variant="bodyM15" color="secondary">
            You can change this anytime in Settings.
          </MiText>
        </View>

        {/* Languages 301:4340 */}
        <View style={{ gap: 10 }}>
          {LANGUAGES.map((l) => (
            <MiOptionRow
              key={l.code}
              title={l.native}
              subtitle={l.english}
              selected={draft === l.code}
              onPress={() => setDraft(l.code)}
            />
          ))}
        </View>

        {/* Done 301:4387 */}
        <MiButton tone="dark" label="Done" onPress={doneSheet} />
      </MiSheet>

      {/* Appearance sheet 301:4427 — the app is light-only today (store/themeStore.ts), so the
          choice is remembered and saved to the account, but the app stays light until a dark
          theme exists (reported). A failed save is silent (the cache keeps the choice and the
          next Done retries). */}
      <AppearanceSheet
        visible={appearanceOpen}
        value={appearance}
        onClose={() => setAppearanceOpen(false)}
        onDone={(c) => {
          storage.set(APPEARANCE_KEY, c);
          setAppearance(c);
          setAppearanceOpen(false);
          updateProfile.mutate({ appearance: c });
        }}
      />
    </MiScreen>
  );
}
