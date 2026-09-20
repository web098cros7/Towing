import React, { useCallback, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@towing/theme';
import { Text } from '@towing/ui';
import { Download, Trash2, X } from '@/icons';
import { SubScreen } from '@/components/SubScreen';
import { SettingsList } from '@/components/SettingsList';
import { SettingsRow } from '@/components/SettingsRow';
import { ApiClientError } from '@/lib/api/errors';
import { useDeleteAccount, useExportData } from '@/features/account/api/privacy.queries';
import { useContentPages } from '@/features/content/api/content.queries';
import { useAuthStore } from '@/features/auth/store/authStore';
import { POLICY_VERSION } from '@/lib/legal/policyVersion';
import { Pressable } from '@/motion';

function LegalHeading({ title }: { title: string }) {
  return (
    <Text variant="overline" color="tertiary" style={{ paddingHorizontal: 4 }}>
      {title}
    </Text>
  );
}

function LegalSection({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text weight="semibold" style={{ fontSize: 15, lineHeight: 20 }}>
        {title}
      </Text>
      <Text color="secondary" style={{ fontSize: 13, lineHeight: 19 }}>
        {body}
      </Text>
    </View>
  );
}

/**
 * Placeholder legal copy — the FALLBACK now (W15): the canonical text lives in
 * `content_pages` and is editable from the admin console, and this copy answers
 * only when that read fails, so Legal is never a blank screen.
 *
 * The DPDP action rows below are unaffected either way: they hit the real
 * `/me/privacy/*` endpoints.
 */
const PRIVACY_SECTIONS = [
  {
    title: 'What we collect',
    body: 'Your mobile number, name, saved vehicles, saved addresses and emergency contacts, plus booking and location data needed to arrange a tow.',
  },
  {
    title: 'How we use it',
    body: 'To match you with a nearby driver, keep you updated on a booking, and improve the safety and reliability of the service.',
  },
  {
    title: 'Your rights',
    body: 'You can review, correct, export or delete your data at any time from this screen, in line with the Digital Personal Data Protection Act.',
  },
];

const TERMS_SECTIONS = [
  {
    title: 'Using MiTow',
    body: 'The app connects you with independent towing partners. Fares, ETAs and vehicle availability are estimates and may vary at the time of service.',
  },
  {
    title: 'Your responsibilities',
    body: 'Provide accurate pickup/drop details and vehicle information, and keep your account credentials confidential.',
  },
  {
    title: 'Liability',
    body: 'MiTow facilitates the booking; the towing partner is responsible for the service performed on your vehicle.',
  },
];

export function LegalScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const clearSession = useAuthStore((s) => s.clearSession);
  const queryClient = useQueryClient();
  const exportData = useExportData();
  const deleteAccount = useDeleteAccount();
  const [exportResult, setExportResult] = useState<string | null>(null);

  // The published legal pages, when they can be read. Empty (offline, or an
  // operator unpublished everything by mistake) falls through to the bundled
  // sections below rather than to an empty screen — a user being asked to
  // accept terms must be able to read them.
  const legal = useContentPages('legal');
  const legalPages = legal.data?.items ?? [];

  const onDownloadData = useCallback(() => {
    exportData.mutate(undefined, {
      onSuccess: (data) => setExportResult(JSON.stringify(data, null, 2)),
      onError: () => Alert.alert('Something went wrong', 'Could not fetch your data right now.'),
    });
  }, [exportData]);

  const onDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete your account?',
      'This files a deletion request for your profile, vehicles, addresses and booking history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () =>
            deleteAccount.mutate(undefined, {
              onSuccess: () => {
                Alert.alert('Request received', 'Your account deletion request has been filed.', [
                  {
                    text: 'OK',
                    onPress: () => {
                      clearSession();
                      // The deleted user's profile/vehicles/addresses/contacts
                      // are cached query results, not session state —
                      // clearSession() alone leaves them sitting in the
                      // persisted (plaintext MMKV) query cache for up to its
                      // 24h maxAge. Same two-call pattern as useLogout.
                      queryClient.clear();
                    },
                  },
                ]);
              },
              onError: (error) => {
                // 409 = `uq_deletion_requests_one_open_per_subject`; the request
                // IS filed, so a generic failure message would be misleading.
                if (error instanceof ApiClientError && error.status === 409) {
                  Alert.alert('Already requested', 'Your account deletion request is already being processed.');
                  return;
                }
                Alert.alert('Something went wrong', 'Could not file the deletion request right now.');
              },
            }),
        },
      ],
    );
  }, [deleteAccount, clearSession]);

  return (
    <SubScreen title="Legal" gap={20}>
      {legalPages.length > 0 ? (
        legalPages.map((page) => (
          <View key={page.slug} style={{ gap: 6 }}>
            <LegalHeading title={page.title} />
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 19 }} selectable>
              {page.bodyMd}
            </Text>
          </View>
        ))
      ) : (
        <>
          <LegalHeading title="Privacy Policy" />
          {PRIVACY_SECTIONS.map((s) => (
            <LegalSection key={s.title} title={s.title} body={s.body} />
          ))}

          <View style={{ height: 1, backgroundColor: theme.colors.border }} />

          <LegalHeading title="Terms of Service" />
          {TERMS_SECTIONS.map((s) => (
            <LegalSection key={s.title} title={s.title} body={s.body} />
          ))}
        </>
      )}

      <Text variant="caption" color="tertiary">
        Policy version {POLICY_VERSION}
      </Text>

      <SettingsList>
        <SettingsRow
          icon={Download}
          title="Download my data"
          subtitle="Get a copy of everything we hold about you"
          trailing="chevron"
          onPress={onDownloadData}
        />
        <SettingsRow
          icon={Trash2}
          iconColor={theme.colors.error}
          title="Delete my account"
          subtitle="Permanently remove your account"
          danger
          trailing="chevron"
          onPress={onDeleteAccount}
        />
      </SettingsList>

      <Modal visible={!!exportResult} animationType="slide" onRequestClose={() => setExportResult(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingVertical: 12,
            }}
          >
            <Text weight="bold" style={{ fontSize: 18 }}>
              Your Data
            </Text>
            <Pressable
              onPress={() => setExportResult(null)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
            >
              <X size={22} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
            <Text style={{ fontSize: 12, lineHeight: 17 }} selectable>
              {exportResult}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SubScreen>
  );
}
