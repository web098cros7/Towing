import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import { usePressablePrimitive } from '@towing/ui';
import { useTheme } from '@towing/theme';
import {
  MiButton,
  MiMenuCard,
  MiMenuRow,
  MiNavBar,
  MiScreen,
  MiText,
  MiTextField,
  mitowColors,
  mitowLayout,
} from '@/design';
import type { RootStackParamList } from '@/navigation/types';
import { useCreateEmergencyContact } from '@/features/account/api/emergencyContacts.queries';

/**
 * Figma 52 · Add Emergency Contact (node 296:3220).
 *
 * Layout:
 * - MiScreen edges=['top'] with footer holding Save Contact (296:3464).
 * - Body ScrollView: NavBar, "Pick contact" menu card (296:3401),
 *   "or enter manually" divider (296:3421), Full Name (296:3425),
 *   Phone Number (296:3437), Relation chips (296:3449).
 */

const RELATION_OPTIONS = ['Spouse', 'Parent', 'Sibling', 'Friend', 'Other'] as const;

type RelationOption = (typeof RELATION_OPTIONS)[number];

/**
 * Normalises a raw contact number to the 10-digit Indian mobile the phone
 * field expects. Strips non-digits, then drops a leading '91' when 12 digits
 * remain or a leading '0' when 11 remain. Anything else is returned as-is so
 * the field's own validation can speak.
 */
function normaliseIndianMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/**
 * Figma 296:3449 · Relation chip.
 * Single-select; tapping the selected chip again clears the selection.
 */
function MiChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const Pressable = usePressablePrimitive();
  const theme = useTheme();

  return (
    <Pressable
      pressScale={theme.motion.pressScale.row}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
    >
      <MiText variant="bodyM15" color={selected ? 'primary' : 'secondary'}>
        {label}
      </MiText>
    </Pressable>
  );
}

export function AddEmergencyContactScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const createContact = useCreateEmergencyContact();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && phone.trim().length > 0;

  const save = () => {
    // Backend `mobileSchema` wants strict E.164 (+91XXXXXXXXXX, no spaces) — this
    // screen does no format validation of its own, only whitespace stripping.
    createContact.mutate(
      {
        name: name.trim(),
        phone: phone.trim().replace(/\s+/g, ''),
        relation: relation ? relation : undefined,
      },
      { onSuccess: () => navigation.goBack() },
    );
  };

  const toggleRelation = (option: RelationOption) => {
    setRelation((current) => (current === option ? null : option));
  };

  const chooseFromContacts = async () => {
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Contacts permission needed',
          'Allow MiTow to read your contacts to pick one, or type the details below.',
        );
        return;
      }

      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;

      const pickedName =
        contact.name ??
        [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
      if (pickedName) setName(pickedName);

      const rawNumber = contact.phoneNumbers?.[0]?.number;
      if (rawNumber) setPhone(normaliseIndianMobile(rawNumber));
    } catch {
      Alert.alert('Could not open your contacts', 'Please type the details instead.');
    }
  };

  return (
    <MiScreen
      edges={['top']}
      footer={
        <View
          style={{
            paddingHorizontal: mitowLayout.sideMargin,
            paddingBottom: Math.max(insets.bottom, 43),
          }}
        >
          {/* Figma 296:3464 · Save Contact */}
          <MiButton
            tone="dark"
            label="Save Contact"
            onPress={save}
            disabled={!canSave}
            loading={createContact.isPending}
          />
        </View>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {/* Figma 296:3220 · NavBar */}
        <MiNavBar title="Add Contact" trailing="none" onBack={() => navigation.goBack()} />

        {/* Figma 296:3401 · Pick contact */}
        <MiMenuCard radius={16} paddingVertical={4}>
          <MiMenuRow
            icon={{ color: 'user' }}
            title="Choose from phone contacts"
            subtitle="Fill name and number in one tap"
            showChevron
            onPress={chooseFromContacts}
          />
        </MiMenuCard>

        {/* Figma 296:3421 · "or enter manually" divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <MiText variant="label13" color="secondary">
            or enter manually
          </MiText>
          <View style={styles.dividerLine} />
        </View>

        {/* Figma 296:3425 · Full Name */}
        <MiTextField
          label="Full Name"
          value={name}
          onChangeText={setName}
          placeholder="Priya Sharma"
          autoCapitalize="words"
          autoComplete="name"
        />

        {/* Figma 296:3437 · Phone Number */}
        <MiTextField
          label="Phone Number"
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98765 00001"
          keyboardType="phone-pad"
          autoComplete="tel"
        />

        {/* Figma 296:3449 · Relation */}
        <View style={styles.relationBlock}>
          <View style={styles.relationLabelRow}>
            <MiText variant="medium16">Relation</MiText>
            <MiText variant="bodyM15" color="secondary">
              (optional)
            </MiText>
          </View>
          <View style={styles.chipsRow}>
            {RELATION_OPTIONS.map((option) => (
              <MiChip
                key={option}
                label={option}
                selected={relation === option}
                onPress={() => toggleRelation(option)}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </MiScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: mitowLayout.sideMargin,
    gap: mitowLayout.blockGap,
    paddingBottom: 24,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: mitowColors.borderSubtle,
  },
  relationBlock: {
    gap: 12,
  },
  relationLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipUnselected: {
    backgroundColor: mitowColors.surfacePage,
    borderColor: mitowColors.borderSubtle,
  },
  chipSelected: {
    backgroundColor: mitowColors.brandYellowSoft,
    borderColor: mitowColors.brandYellow,
  },
});
