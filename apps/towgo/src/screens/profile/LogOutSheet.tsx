import React from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import {
  MiSheet,
  MiText,
  MiButton,
  MiColorIcon,
  mitowColors,
  avatarDefaultIllustration,
} from '@/design';
import { SlotPlaceholder } from '@/screens/booking/tracking/SlotPlaceholder';

/**
 * Formats a mobile number for display.
 * '+91' followed by exactly 10 digits → '+91 98765 43210' (5 + 5 split).
 * Otherwise returns the number as stored.
 */
function formatMobile(m: string): string {
  const match = /^\+91(\d{10})$/.exec(m);
  if (match) {
    const digits = match[1];
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return m;
}

/**
 * Figma 46 · Log Out (298:3772)
 *
 * Bottom sheet shown over 38 Profile. Confirms signing out.
 */
export function LogOutSheet({
  visible,
  onClose,
  name,
  mobile,
  loggingOut,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  name: string | null;
  mobile: string | null;
  loggingOut: boolean;
  onConfirm: () => void;
}) {
  return (
    <MiSheet
      visible={visible}
      onClose={onClose}
      onBackdropPress={onClose}
      accessibilityLabel="Log out?"
    >
      {/* Icon 298:3775 */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: mitowColors.brandYellowSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MiColorIcon name="log-out" size={36} />
      </View>

      {/* Heading 298:3777 */}
      <View style={{ gap: 6 }}>
        <MiText variant="title23">Log out?</MiText>
        <MiText variant="bodyL155" color="secondary">
          You will need to sign in again to book a tow.
        </MiText>
      </View>

      {/* Signed in as 298:3780 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: mitowColors.surfaceMuted,
          borderRadius: 14,
          paddingVertical: 12,
          paddingLeft: 12,
          paddingRight: 14,
        }}
      >
        <SvgXml xml={avatarDefaultIllustration} width={40} height={40} />
        <View style={{ flex: 1, gap: 1 }}>
          {name ? (
            <MiText variant="strong15" numberOfLines={1}>
              {name}
            </MiText>
          ) : (
            <SlotPlaceholder variant="strong15" width={97} />
          )}
          {mobile ? (
            <MiText variant="bodyS14" color="secondary">
              {formatMobile(mobile)}
            </MiText>
          ) : (
            <SlotPlaceholder variant="bodyS14" width={114} />
          )}
        </View>
      </View>

      {/* Actions 298:3786 */}
      <View style={{ gap: 10 }}>
        <MiButton tone="dangerSoft" label="Log Out" onPress={onConfirm} loading={loggingOut} />
        <MiButton tone="quiet" label="Cancel" onPress={onClose} disabled={loggingOut} />
      </View>
    </MiSheet>
  );
}
