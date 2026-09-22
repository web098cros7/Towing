import React, { useCallback } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePressablePrimitive, ErrorState } from '@towing/ui';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiButton,
  MiMenuCard,
  MiMenuRow,
  MiInfoBanner,
  mitowLayout,
} from '@/design';
import {
  useEmergencyContacts,
  useDeleteEmergencyContact,
} from '@/features/account/api/emergencyContacts.queries';
import type { RootStackParamList } from '@/navigation/types';

/**
 * Format a stored phone number for display.
 * '+91' + exactly 10 digits → '+91 98765 00001' (5 + 5 split).
 * Bare 10-digit number → '+91 ' + 5 + ' ' + 5.
 * Otherwise, return as stored.
 */
function formatMobile(phone: string): string {
  const stripped = phone.replace(/\s+/g, '');
  if (/^\+91\d{10}$/.test(stripped)) {
    const digits = stripped.slice(3);
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (/^\d{10}$/.test(stripped)) {
    return `+91 ${stripped.slice(0, 5)} ${stripped.slice(5)}`;
  }
  return phone;
}

/**
 * Figma 51 · Emergency Contacts (296:3169).
 */
export function EmergencyContactsScreen() {
  const insets = useSafeAreaInsets();
  const Pressable = usePressablePrimitive();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: contacts, isError, refetch } = useEmergencyContacts();
  const deleteContact = useDeleteEmergencyContact();

  const confirmDelete = useCallback(
    (contactId: string, name: string) => {
      Alert.alert('Remove contact?', `${name} will no longer be notified during SOS.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => deleteContact.mutate(contactId) },
      ]);
    },
    [deleteContact],
  );

  const hasContacts = !!contacts && contacts.length > 0;

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
          {/* 296:3388 Add Contact */}
          <MiButton
            tone="dark"
            label="Add Contact"
            onPress={() => navigation.navigate('AddEmergencyContact')}
          />
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: mitowLayout.sideMargin,
          gap: mitowLayout.blockGap,
          paddingBottom: 24,
        }}
      >
        {/* Nav bar */}
        <MiNavBar title="Emergency Contacts" trailing="none" onBack={() => navigation.goBack()} />

        {/* 296:3336 SOS banner */}
        <MiInfoBanner
          tone="brand"
          icon="verified"
          title="Who we alert in an emergency"
          subtitle="If you trigger SOS during a tow, we send these contacts your live location."
          height={85}
        />

        {/* 296:3345 Contacts */}
        {isError && !hasContacts ? (
          <ErrorState title="Couldn't load your emergency contacts" onRetry={() => refetch()} />
        ) : hasContacts ? (
          <View style={{ gap: 12 }}>
            <MiText variant="heading18">Your Contacts</MiText>
            <MiMenuCard radius={16} paddingVertical={4}>
              {contacts!.map((c) => (
                <MiMenuRow
                  key={c.id}
                  icon={{ color: 'user' }}
                  title={c.name}
                  subtitle={[formatMobile(c.phone), c.relation].filter(Boolean).join(' · ')}
                  trailing={
                    <Pressable
                      pressScale={1}
                      haptic="light"
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${c.name}`}
                      onPress={() => confirmDelete(c.id, c.name)}
                    >
                      <MiText variant="strong14" color="danger">
                        Remove
                      </MiText>
                    </Pressable>
                  }
                />
              ))}
            </MiMenuCard>
          </View>
        ) : null}
      </ScrollView>
    </MiScreen>
  );
}
