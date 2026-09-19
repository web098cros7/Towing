import React, { useEffect, useRef, useState } from 'react';
import { Modal, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';
import { MiButton, MiOptionRow, MiSheet, MiText, MiTextField } from '@/design';
import { displayMobile, formatIndianMobile, nationalDigits } from './enter-location/format';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useProfile } from '@/features/account/api/profile.queries';

/**
 * §9.1.5's note editor and its "booking for someone else" contact capture.
 *
 * Both controls existed and did nothing: the "Add Note" row's `onPress` was the
 * shared `notReady` no-op (`store.setNote` was never called from anywhere), and
 * the "For someone else" pill flipped a label whose value reached no request.
 * Phase 15 gives the backend `bookings.note`, `contact_name` and
 * `contact_mobile` to put them in.
 *
 * ⚠ THESE TWO SHEETS ARE NOW ON DIFFERENT DESIGN SYSTEMS, and that is
 * deliberate rather than an oversight. `ContactSheet` is Figma 12 and has been
 * redesigned; `NoteEditorSheet` has not been drawn yet, so it keeps the legacy
 * `SheetShell` below. Restyling it to match would mean inventing a design.
 */

function SheetShell({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function fieldStyle(theme: ReturnType<typeof useTheme>) {
  return {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
    color: theme.colors.textPrimary,
    fontSize: 15,
  } as const;
}

export function NoteEditorSheet({
  visible,
  note,
  onSave,
  onClose,
}: {
  visible: boolean;
  note: string;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState(note);

  // Re-seed each time it opens, so cancelling really discards.
  useEffect(() => {
    if (visible) setDraft(note);
  }, [visible, note]);

  return (
    <SheetShell visible={visible} title="Add a note for the driver" onClose={onClose}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Blue hatchback, basement parking…"
        placeholderTextColor={theme.colors.textTertiary}
        multiline
        // The server caps this at 500; stopping at the boundary is friendlier
        // than a 422 after the customer has typed a paragraph.
        maxLength={500}
        accessibilityLabel="Note for the driver"
        style={[fieldStyle(theme), { minHeight: 96, textAlignVertical: 'top' }]}
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Save"
            onPress={() => {
              onSave(draft.trim());
              onClose();
            }}
            fullWidth
          />
        </View>
      </View>
    </SheetShell>
  );
}

/**
 * Figma 12 · Who's the Tow For (sheet 299:3978), opened by the "For me" pill.
 *
 * "It's for me" shows the account holder (name · +91 98765 43210). "Someone
 * else" reveals "Their name" and "Their mobile number". The mobile is shown with
 * the drawn "+91 XXXXX XXXXX" mask and saved normalised (`+91` + 10 digits),
 * which is what the contract's `^\+?[0-9]{10,15}$` accepts.
 *
 * Save is drawn in its normal look. With an incomplete contact it does not
 * close; it moves focus to the field that still needs input.
 */
export function ContactSheet({
  visible,
  contact,
  onSave,
  onClose,
}: {
  visible: boolean;
  contact: { name: string; mobile: string } | null;
  onSave: (contact: { name: string; mobile: string } | null) => void;
  onClose: () => void;
}) {
  const identity = useAuthStore((s) => s.identity);
  const [forSomeoneElse, setForSomeoneElse] = useState(contact !== null);
  const [name, setName] = useState(contact?.name ?? '');
  const [digits, setDigits] = useState(contact ? nationalDigits(contact.mobile) : '');
  const nameRef = useRef<TextInput | null>(null);
  const mobileRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (!visible) return;
    setForSomeoneElse(contact !== null);
    setName(contact?.name ?? '');
    setDigits(contact ? nationalDigits(contact.mobile) : '');
  }, [visible, contact]);

  // "<name> · +91 98765 43210". The session identity has an empty name until
  // Profile Setup (05) is submitted, so the profile (/me) fills either part the
  // identity is missing. A part neither source has is left out rather than
  // invented, and the separator only joins two real parts.
  const { data: profile } = useProfile();
  const meName = identity?.name?.trim() || profile?.name?.trim() || '';
  const meMobile = displayMobile(identity?.mobile || profile?.mobile);
  const meSubtitle = [meName, meMobile].filter(Boolean).join(' · ');

  const onChangeMobile = (text: string) => {
    // The "+91" prefix is display only: strip it before reading digits so that
    // deleting back into it clears the field instead of re-reading "91".
    const body = text.startsWith('+91') ? text.slice(3) : text;
    setDigits(nationalDigits(body).slice(0, 10));
  };

  const save = () => {
    if (!forSomeoneElse) {
      // `null` returns the booking to the account holder.
      onSave(null);
      onClose();
      return;
    }
    if (name.trim().length === 0) {
      nameRef.current?.focus();
      return;
    }
    if (digits.length !== 10) {
      mobileRef.current?.focus();
      return;
    }
    onSave({ name: name.trim(), mobile: `+91${digits}` });
    onClose();
  };

  return (
    <MiSheet
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      scrollable
      accessibilityLabel="Who is the tow for?"
    >
      <View style={{ gap: 4 }}>
        <MiText variant="title23">Who is the tow for?</MiText>
        <MiText variant="bodyM15" color="secondary">
          The driver will call this person on arrival.
        </MiText>
      </View>

      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        <MiOptionRow
          icon="user"
          title="It's for me"
          subtitle={meSubtitle || undefined}
          selected={!forSomeoneElse}
          onPress={() => setForSomeoneElse(false)}
        />
        <MiOptionRow
          icon="user-plus"
          title="Someone else"
          subtitle="Add their name and number"
          selected={forSomeoneElse}
          onPress={() => setForSomeoneElse(true)}
        />
      </View>

      {forSomeoneElse ? (
        <>
          <MiTextField
            label="Their name"
            value={name}
            onChangeText={setName}
            inputRef={nameRef}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => mobileRef.current?.focus()}
            maxLength={120}
          />
          <MiTextField
            label="Their mobile number"
            value={formatIndianMobile(digits)}
            onChangeText={onChangeMobile}
            inputRef={mobileRef}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="done"
            onSubmitEditing={save}
            maxLength={15}
          />
        </>
      ) : null}

      <MiButton label="Save" onPress={save} />
    </MiSheet>
  );
}
