import React, { useCallback, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@towing/theme';
import { Screen, Text } from '@towing/ui';
import { Download, Trash2, X } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { MenuCard } from '@/components/MenuCard';
import { MenuRow } from '@/components/MenuRow';
import { ApiClientError } from '@/lib/api/errors';
import { clearQueuedMutations } from '@/lib/mutationQueue/queue';
import { useDeleteAccount, useExportData } from '@/features/account/api/privacy.queries';
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
 * Placeholder legal copy — not the focus of this phase, only that the screen
 * exists and the DPDP action rows below are wired to the real `/me` endpoints.
 */
const PRIVACY_SECTIONS = [
  {
    title: 'What we collect',
    body: 'Your mobile number, name, KYC documents, vehicle capabilities and bank details, plus the location and job data needed to dispatch and pay you.',
  },
  {
    title: 'How we use it',
    body: 'To verify you as a towing partner, offer you nearby jobs, share your live position with the customer during a job, and settle your earnings.',
  },
  {
    title: 'Your rights',
    body: 'You can review, correct, export or delete your data at any time from this screen, in line with the Digital Personal Data Protection Act.',
  },
];

const TERMS_SECTIONS = [
  {
    title: 'Working through MiTow Driver',
    body: 'You operate as an independent towing partner. Accepting a job is your choice; once accepted you are responsible for completing it safely and on time.',
  },
  {
    title: 'Your responsibilities',
    body: 'Keep your licence, insurance and vehicle documents current, follow local traffic and towing regulations, and keep your account credentials confidential.',
  },
  {
    title: 'Payouts',
    body: 'Earnings are settled to the bank account on your profile after the platform commission. Cancellations and disputes may adjust a settled amount.',
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

  const onDownloadData = useCallback(() => {
    exportData.mutate(undefined, {
      onSuccess: (data) => setExportResult(JSON.stringify(data, null, 2)),
      onError: () => Alert.alert('Something went wrong', 'Could not fetch your data right now.'),
    });
  }, [exportData]);

  const onDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete your account?',
      'This files a deletion request for your partner profile, documents and job history. This cannot be undone.',
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
                      // Profile/KYC/jobs/earnings are cached query results, not
                      // session state — clearSession() alone leaves them in the
                      // persisted (plaintext MMKV) query cache for up to its
                      // maxAge. And a queued mutation replays under whoever is
                      // logged in when connectivity returns, so one left behind
                      // would fire under the next driver. Same three calls as
                      // `useLogout`, for the same reasons.
                      queryClient.clear();
                      clearQueuedMutations();
                    },
                  },
                ]);
              },
              onError: (error) => {
                // 409 = `uq_deletion_requests_one_open_per_subject`; the driver
                // already asked, so this is reassurance, not a failure.
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
  }, [deleteAccount, clearSession, queryClient]);

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 32 }}>
      <DriverHeader
        leading="back"
        title="Legal"
        titleSize={22}
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, gap: 20 }}>
        <LegalHeading title="Privacy Policy" />
        {PRIVACY_SECTIONS.map((s) => (
          <LegalSection key={s.title} title={s.title} body={s.body} />
        ))}

        <View style={{ height: 1, backgroundColor: theme.colors.border }} />

        <LegalHeading title="Terms of Service" />
        {TERMS_SECTIONS.map((s) => (
          <LegalSection key={s.title} title={s.title} body={s.body} />
        ))}

        <Text variant="caption" color="tertiary">
          Policy version {POLICY_VERSION}
        </Text>

        <MenuCard>
          <MenuRow
            icon={Download}
            tone="blue"
            title="Download my data"
            subtitle="Get a copy of everything we hold about you"
            onPress={onDownloadData}
          />
          <MenuRow
            icon={Trash2}
            title="Delete my account"
            subtitle="Permanently remove your partner account"
            danger
            onPress={onDeleteAccount}
          />
        </MenuCard>
      </View>

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
    </Screen>
  );
}
