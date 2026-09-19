import React from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mitowColors, mitowLayout, MiNavBar, MiText } from '@/design';
import { POLICY_VERSION } from '@/lib/legal/policyVersion';
import { legalDocuments, type LegalDocumentKey } from './legalDocuments';

export type LegalDocumentModalProps = {
  visible: boolean;
  document: LegalDocumentKey;
  onClose: () => void;
};

/**
 * Read-only Terms of Service / Privacy Policy for a customer who is not signed in
 * yet.
 *
 * 04 draws "Terms of Service" and "Privacy Policy" as links but no destination.
 * The app's legal screen (route `Legal`) is registered only in the signed-in
 * stack, and it also carries "Download my data" and "Delete my account", which
 * need a session. VerifyOtpScreen therefore opens `Legal` whenever the navigator
 * registers it and falls back to this reader otherwise, so the links are never
 * dead.
 *
 * Built from the MiTow primitives only: page white, the Nav Bar (back chevron,
 * Heading 18 title), and Strong 15 / Body S 14 sections inside the 21 side margin.
 */
export function LegalDocumentModal({ visible, document, onClose }: LegalDocumentModalProps) {
  const insets = useSafeAreaInsets();
  const doc = legalDocuments[document];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: mitowColors.surfacePage, paddingTop: insets.top }}>
        <View style={{ paddingHorizontal: mitowLayout.sideMargin }}>
          <MiNavBar title={doc.title} trailing="none" onBack={onClose} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingTop: mitowLayout.blockGap,
            paddingBottom: Math.max(34, insets.bottom + mitowLayout.blockGap),
            gap: mitowLayout.blockGap,
          }}
          showsVerticalScrollIndicator={false}
        >
          {doc.sections.map((section) => (
            <View key={section.title} style={{ gap: 6 }}>
              <MiText variant="strong15" color="primary">
                {section.title}
              </MiText>
              <MiText variant="bodyS14" color="secondary">
                {section.body}
              </MiText>
            </View>
          ))}
          <MiText variant="label13" color="placeholder">
            {`Policy version ${POLICY_VERSION}`}
          </MiText>
        </ScrollView>
      </View>
    </Modal>
  );
}
