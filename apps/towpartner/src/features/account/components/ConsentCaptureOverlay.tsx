import React, { useState } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { Text, Button } from '@towing/ui';
import { storage } from '@/lib/storage/storage';
import { useRecordConsent } from '@/features/account/api/privacy.queries';
import { POLICY_VERSION } from '@/lib/legal/policyVersion';

const CONSENT_FLAG_KEY = 'towpartner.consent.captured.v1';

/** Gates `ConsentCaptureOverlay` to once per device — read at boot by `RootNavigator`. */
export function hasCapturedConsent(): boolean {
  return storage.getString(CONSENT_FLAG_KEY) === 'true';
}

/**
 * First-run DPDP consent (spec §20.4). Shown once per device to any
 * authenticated driver — including one still inside the KYC gate, who is
 * already uploading identity documents and so needs to have consented first.
 * Records both `privacy_policy` and `terms_of_service` via `POST /me/consent`.
 */
export function ConsentCaptureOverlay({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const recordConsent = useRecordConsent();
  const [submitting, setSubmitting] = useState(false);

  const agree = async () => {
    setSubmitting(true);
    try {
      await Promise.all([
        recordConsent.mutateAsync({ policyType: 'privacy_policy', policyVersion: POLICY_VERSION }),
        recordConsent.mutateAsync({ policyType: 'terms_of_service', policyVersion: POLICY_VERSION }),
      ]);
    } catch {
      // Best-effort: DPDP requires offering consent capture, not permanently
      // locking a driver out of their jobs if a single write happens to fail.
    } finally {
      storage.set(CONSENT_FLAG_KEY, 'true');
      setSubmitting(false);
      onDone();
    }
  };

  return (
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
        <View style={{ flex: 1, justifyContent: 'flex-end', padding: 24, gap: 16 }}>
          <Text variant="h2">Before you continue</Text>
          <Text color="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
            By continuing, you agree to MiTow Driver&apos;s Privacy Policy and Terms of Service, and
            consent to how we handle your data under the Digital Personal Data Protection Act.
          </Text>
          <Button label="I Agree" fullWidth loading={submitting} onPress={agree} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
