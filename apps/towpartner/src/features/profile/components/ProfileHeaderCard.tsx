import React from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Text, type IconComponent } from '@towing/ui';
import { Camera, ShieldCheck, Phone, Mail, ChevronRight } from '@/icons';
import { IconChip } from '@/components/IconChip';
import { Pill } from '@/components/Pill';
import { HeroCard } from '@/components/HeroCard';
import { driverColors } from '@/theme/driverColors';
import type { DriverProfile } from '../types';
import { Pressable } from '@/motion';

const AVATAR = 85;

/** Rendered when `profile.avatar` is null — the API returns a URL or nothing, never an asset. */
const AVATAR_PLACEHOLDER = require('@/assets/illustrations/driver-avatar.png');

/**
 * Full-width contact row. The Figma squeezes phone + email side-by-side at
 * 8–9px; stacked rows keep the same content readable without overflow.
 */
function ContactRow({
  icon,
  value,
  label,
}: {
  icon: IconComponent;
  value: string;
  label: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <IconChip icon={icon} tone="blue" size={40} iconSize={14} />
      <View style={{ flex: 1 }}>
        {/* Figma 78:930 sets these at 9.5 and 8.3 -- below the 10dp legibility floor,
            so they stay at 13/11. See the note at the top of this file. */}
        <Text weight="medium" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>
          {value}
        </Text>
        <Text color="secondary" numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Profile hero (Figma 78:950): avatar, name, id, verification + contact details. */
export function ProfileHeaderCard({
  profile,
  onPress,
}: {
  profile: DriverProfile;
  onPress?: () => void;
}) {
  const theme = useTheme();

  return (
    <HeroCard style={{ backgroundColor: driverColors.profileCardBg, borderRadius: 16, padding: 16 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Edit profile"
        style={() => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        })}
      >
        {/* Avatar in a cream ring, photo anchored to the bottom (Figma crop). */}
        <View>
          <View
            style={{
              width: AVATAR,
              height: AVATAR,
              borderRadius: AVATAR / 2,
              backgroundColor: driverColors.avatarRing,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
          >
            <Image
              source={profile.avatar ? { uri: profile.avatar } : AVATAR_PLACEHOLDER}
              resizeMode="contain"
              style={{ width: 78, height: 88, marginBottom: -2 }}
            />
          </View>
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: 3,
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: theme.colors.card,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.1,
              shadowRadius: 3,
              elevation: 2,
            }}
          >
            <Camera size={13} color="#374151" strokeWidth={2} />
          </View>
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text numberOfLines={1} style={{ fontSize: 19.5, lineHeight: 29, flexShrink: 1 }}>
              {profile.name}
            </Text>
            <ChevronRight size={15} color={theme.colors.textTertiary} strokeWidth={2} />
          </View>
          <Pill
            label={`DRIVER ID: ${profile.driverId}`}
            bg="#E5E7EB"
            fg="#374151"
            radius={5.5}
          />
          {profile.verified ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
              <ShieldCheck size={13} color={driverColors.online} strokeWidth={2.2} />
              <Text style={{ fontSize: 13, lineHeight: 20, color: driverColors.online }}>
                Verified
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      <View style={{ height: 1, backgroundColor: '#E5E7EB', marginTop: 15, marginBottom: 13 }} />

      <View style={{ gap: 11 }}>
        <ContactRow icon={Phone} value={profile.phone} label="Mobile Number" />
        {profile.email !== null ? (
          <ContactRow icon={Mail} value={profile.email} label="Email Address" />
        ) : null}
      </View>
    </HeroCard>
  );
}
