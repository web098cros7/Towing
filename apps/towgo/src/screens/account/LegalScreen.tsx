import React, { useCallback, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@towing/theme';
import { Text } from '@towing/ui';
import { X } from '@/icons';
import { MiFaqCard, MiFaqRow } from '@/design/components/MiFaqRow';
import { MiMenuCard, MiMenuRow, MiNavBar, MiScreen, MiText, mitowLayout } from '@/design';
import { ApiClientError } from '@/lib/api/errors';
import { useDeleteAccount, useExportData } from '@/features/account/api/privacy.queries';
import { useContentPages } from '@/features/content/api/content.queries';
import { useAuthStore } from '@/features/auth/store/authStore';
import { POLICY_VERSION } from '@/lib/legal/policyVersion';
import { Pressable } from '@/motion';
import type { RootStackParamList } from '@/navigation/types';
import { DeleteAccountSheet } from './DeleteAccountSheet';

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
    body: 'Your name, phone number, email, vehicle details and trip locations, so we can send a tow truck and bill you correctly.',
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

/** '2026-08-10' → '10 Aug 2026'. */
function formatPolicyDate(iso: string): string {
  const [year, month, day] = iso.split('-').map((part) => Number(part));
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${day} ${months[month - 1]} ${year}`;
}

export function LegalScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const clearSession = useAuthStore((s) => s.clearSession);
  const queryClient = useQueryClient();
  const exportData = useExportData();
  const deleteAccount = useDeleteAccount();
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [open, setOpen] = useState<string | null>('p0');

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
    setDeleteOpen(true);
  }, []);

  const confirmDelete = useCallback(() => {
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        setDeleteOpen(false);
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
        setDeleteOpen(false);
        // 409 = `uq_deletion_requests_one_open_per_subject`; the request
        // IS filed, so a generic failure message would be misleading.
        if (error instanceof ApiClientError && error.status === 409) {
          Alert.alert(
            'Already requested',
            'Your account deletion request is already being processed.',
          );
          return;
        }
        Alert.alert('Something went wrong', 'Could not file the deletion request right now.');
      },
    });
  }, [deleteAccount, clearSession, queryClient]);

  const toggle = useCallback((key: string) => {
    setOpen((current) => (current === key ? null : key));
  }, []);

  return (
    <MiScreen edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
      >
        {/* Nav bar */}
        <MiNavBar title="Privacy & Legal" trailing="none" onBack={() => navigation.goBack()} />

        {/* Privacy Policy `297:3644` */}
        <View style={{ gap: 12 }}>
          <View style={{ gap: 2 }}>
            <MiText variant="heading18">Privacy Policy</MiText>
            <MiText variant="label13" color="secondary">
              {`Version ${POLICY_VERSION} · Updated ${formatPolicyDate(POLICY_VERSION)}`}
            </MiText>
          </View>
          <MiFaqCard>
            {PRIVACY_SECTIONS.map((s, i) => {
              const key = `p${i}`;
              return (
                <MiFaqRow
                  key={key}
                  question={s.title}
                  answer={s.body}
                  expanded={open === key}
                  onToggle={() => toggle(key)}
                />
              );
            })}
          </MiFaqCard>
        </View>

        {/* Terms of Service `297:3671` */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">Terms of Service</MiText>
          <MiFaqCard>
            {TERMS_SECTIONS.map((s, i) => {
              const key = `t${i}`;
              return (
                <MiFaqRow
                  key={key}
                  question={s.title}
                  answer={s.body}
                  expanded={open === key}
                  onToggle={() => toggle(key)}
                />
              );
            })}
          </MiFaqCard>
        </View>

        {/* Your Data `297:3697` */}
        <View style={{ gap: 12 }}>
          <MiText variant="heading18">Your Data</MiText>
          <MiMenuCard radius={16} paddingVertical={4}>
            <MiMenuRow
              icon={{ color: 'download' }}
              title="Download my data"
              subtitle="A copy of everything we hold"
              showChevron
              onPress={onDownloadData}
            />
            <MiMenuRow
              icon={{ color: 'trash' }}
              title="Delete my account"
              subtitle="Permanently remove your account"
              showChevron
              onPress={onDeleteAccount}
            />
          </MiMenuCard>
        </View>
      </ScrollView>

      <DeleteAccountSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        deleting={deleteAccount.isPending}
        onConfirm={confirmDelete}
      />

      <Modal
        visible={!!exportResult}
        animationType="slide"
        onRequestClose={() => setExportResult(null)}
      >
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
    </MiScreen>
  );
}
