import React from 'react';
import { View } from 'react-native';
import { MiButton, MiColorIcon, MiSheet, MiText, mitowColors } from '@/design';

/**
 * Figma 57 · Delete Account — bottom sheet `298:3705`.
 *
 * Confirmation surface for the account deletion request. The screen that owns
 * the mutation passes `deleting` while the request is in flight and `onConfirm`
 * to fire it.
 */
export function DeleteAccountSheet({
  visible,
  onClose,
  deleting,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  deleting: boolean;
  onConfirm: () => void;
}) {
  return (
    <MiSheet
      visible={visible}
      onClose={onClose}
      onBackdropPress={deleting ? undefined : onClose}
      accessibilityLabel="Delete your account?"
    >
      {/* Icon `298:3708` */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: mitowColors.dangerSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MiColorIcon name="trash-red" size={36} />
      </View>

      {/* Heading `298:3710` */}
      <View style={{ gap: 6 }}>
        <MiText variant="title23">Delete your account?</MiText>
        <MiText variant="bodyL155" color="secondary">
          This files a deletion request for your account. It cannot be undone.
        </MiText>
      </View>

      {/* What we'll delete `298:3713` */}
      <View
        style={{
          backgroundColor: mitowColors.surfaceMuted,
          borderRadius: 14,
          paddingVertical: 14,
          paddingLeft: 14,
          paddingRight: 16,
          gap: 12,
        }}
      >
        <MiText variant="strong14">We'll delete</MiText>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MiColorIcon name="user" size={24} />
          <MiText variant="bodyM15">Your profile and phone number</MiText>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MiColorIcon name="car" size={30} />
          <MiText variant="bodyM15">Vehicles and saved places</MiText>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MiColorIcon name="receipt" size={24} />
          <MiText variant="bodyM15">Booking history and invoices</MiText>
        </View>
      </View>

      {/* Actions `298:3724` */}
      <View style={{ gap: 10 }}>
        <MiButton tone="dangerSoft" label="Delete Account" onPress={onConfirm} loading={deleting} />
        <MiButton tone="quiet" label="Cancel" onPress={onClose} disabled={deleting} />
      </View>
    </MiSheet>
  );
}
