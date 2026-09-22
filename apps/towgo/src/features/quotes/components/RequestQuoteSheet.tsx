import React, { useEffect, useState } from 'react';
import { Modal, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';

/**
 * W20 — the notes sheet for a manual-quote request.
 *
 * The same Modal + shell shape as §9.1.5's note editor, for the same reason:
 * "requesting a quote" is a modal decision, and the note is the only thing the
 * customer can add to a trip the operator is about to price. 500 characters,
 * matching the server's cap — stopping at the boundary beats a 422 after
 * someone has typed a paragraph.
 */
export function RequestQuoteSheet({
  visible,
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (notes: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');

  // Re-seed on each open, so cancelling really discards.
  useEffect(() => {
    if (visible) setDraft('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }}>
        <View
          style={{
            backgroundColor: theme.colors.surface0,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: theme.spacing.xxl,
            paddingBottom: Math.max(insets.bottom, theme.spacing.xxl),
            paddingHorizontal: theme.spacing.xxl,
            gap: theme.spacing.lg,
          }}
        >
          <Text weight="semibold" style={{ fontSize: 18 }}>
            Request a manual quote
          </Text>
          <Text color="secondary" style={{ fontSize: 13, lineHeight: 19 }}>
            Trips over 600 km are priced by our team. Add anything that affects the job — we will
            send a fixed price here.
          </Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Sedan, non-runner, basement parking…"
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            maxLength={500}
            accessibilityLabel="Details for the quote"
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.input,
              backgroundColor: theme.colors.card,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: 12,
              color: theme.colors.textPrimary,
              fontSize: 15,
              minHeight: 96,
              textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" onPress={onClose} fullWidth />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={submitting ? 'Sending…' : 'Request quote'}
                onPress={() => onSubmit(draft.trim())}
                disabled={submitting}
                fullWidth
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
