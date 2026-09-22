import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
          {/*
           * The app has no phone-contacts module yet (expo-contacts is not
           * installed), so this row is drawn but inert. Reported to the owner.
           */}
          <MiMenuRow
            icon={{ color: 'user' }}
            title="Choose from phone contacts"
            subtitle="Fill name and number in one tap"
            showChevron
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
