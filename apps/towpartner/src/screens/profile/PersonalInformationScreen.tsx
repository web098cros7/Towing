import React, { useEffect, useState } from 'react';
import { Alert, Image, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ErrorState, Screen, Skeleton, Text } from '@towing/ui';
import { Pressable } from '@/motion';
import { RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { driverColors } from '@/theme/driverColors';
import {
  useDriverMe,
  useUpdateDriverMe,
  useUploadDriverPhoto,
} from '@/features/profile/api/profile.queries';
import { DocPickCancelled } from '@/features/kyc/api/kyc.queries';
import type { RootStackParamList } from '@/navigation/types';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';

/**
 * The driver's own record.
 *
 * PARTLY EDITABLE. The email and the photo are the driver's own to change.
 *
 * NOT THE NAME, although it briefly was. A driver's name is the one on their
 * driving licence (Ehsan, 23 Sep) — the identity the platform verified, pays
 * against, and shows to a customer about to get into a vehicle with them. A
 * driver who could retype it could quietly become somebody else between two
 * jobs, so it is set when the licence is checked and changed only by support.
 *
 * Also not editable: the mobile (it is the login, so changing it is an
 * identity change, not a profile edit) and the truck, its plate and its papers
 * (the fleet assigns and renews those from the MiTow console — a driver
 * editing their own plate would break the assignment the fleet made).
 */
export function PersonalInformationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: me, isPending, isError, refetch } = useDriverMe();

  const updateMe = useUpdateDriverMe();
  const uploadPhoto = useUploadDriverPhoto();

  const [email, setEmail] = useState('');
  const [emailDirty, setEmailDirty] = useState(false);

  // Seed from the query only when the field is not dirty, so a refetch does
  // not clobber what the driver is typing mid-edit.
  useEffect(() => {
    if (!me) return;
    if (!emailDirty) setEmail(me.email ?? '');
  }, [me, emailDirty]);

  const trimmedEmail = email.trim();
  const changed = trimmedEmail !== (me?.email ?? '');
  const canSave = changed && !updateMe.isPending;

  const onSave = () => {
    updateMe.mutate(
      { email: trimmedEmail || null },
      {
        onSuccess: () => {
          setEmailDirty(false);
          Alert.alert('Saved', 'Your details are up to date.');
        },
        onError: () => {
          Alert.alert("Couldn't save", 'Try again in a moment.');
        },
      },
    );
  };

  const onChangePhoto = () => {
    uploadPhoto.mutate(undefined, {
      onError: (error) => {
        if (error instanceof DocPickCancelled) return;
        Alert.alert(
          'Could not update your photo',
          error instanceof Error ? error.message : 'Try again in a moment.',
        );
      },
    });
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 28 }}>
      <DriverHeader
        leading="back"
        title="Personal Information"
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 3, gap: 12 }}>
        {isPending ? (
          <PersonalInformationSkeleton />
        ) : isError || !me ? (
          <ErrorState title="Couldn't load your details" onRetry={() => refetch()} icon={RefreshCw} />
        ) : (
          <>
            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
              <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
                You
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: HAIRLINE,
                }}
              >
                {me.photoUrl ? (
                  <Image
                    source={{ uri: me.photoUrl }}
                    style={{ width: 64, height: 64, borderRadius: 32 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 32,
                      backgroundColor: driverColors.avatarRing,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 24, lineHeight: 30 }}>
                      {(me.name ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Pressable
                  haptic="light"
                  onPress={onChangePhoto}
                  disabled={uploadPhoto.isPending}
                >
                  <Text style={{ fontSize: 14, lineHeight: 20, color: driverColors.accent }}>
                    {uploadPhoto.isPending ? 'Uploading…' : 'Change photo'}
                  </Text>
                </Pressable>
              </View>

              <InfoRow label="Name" value={me.name ?? '—'} />

              <EditableRow label="Email">
                <TextInput
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setEmailDirty(true);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Add an email (optional)"
                  placeholderTextColor={INK_SOFT}
                  style={{
                    flex: 1,
                    fontSize: 15,
                    lineHeight: 21,
                    textAlign: 'right',
                    paddingVertical: 0,
                  }}
                />
              </EditableRow>

              <InfoRow label="Mobile" value={me.mobile} />
              <Text
                style={{
                  fontSize: 12,
                  lineHeight: 17,
                  color: INK_SOFT,
                  paddingBottom: 10,
                }}
              >
                Your name is the one on your driving licence, and your mobile is your login.
                Contact support to change either.
              </Text>

              <InfoRow
                label="Member since"
                value={new Date(me.memberSince).toLocaleDateString('en-IN', {
                  month: 'long',
                  year: 'numeric',
                })}
              />
              <InfoRow label="Level" value={capitalise(me.level)} />
              <InfoRow
                label="Documents"
                value={me.kycStatus === 'approved' ? 'Verified' : capitalise(me.kycStatus)}
              />

              {changed ? (
                <View style={{ paddingTop: 14 }}>
                  <Button
                    label="Save"
                    fullWidth
                    onPress={onSave}
                    disabled={!canSave}
                    loading={updateMe.isPending}
                  />
                </View>
              ) : null}
            </Card>

            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
              <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
                Your truck
              </Text>
              {me.truck ? (
                <>
                  <InfoRow label="Plate" value={me.truck.plate} />
                  <InfoRow
                    label="Make & model"
                    value={[me.truck.make, me.truck.model].filter(Boolean).join(' ') || '—'}
                  />
                  <InfoRow
                    label="Type"
                    value={me.truck.vehicleClass === 'flatbed' ? 'Flatbed' : 'Wheel-lift'}
                  />
                </>
              ) : (
                <Text style={{ fontSize: 14, lineHeight: 20, color: INK_SOFT, paddingVertical: 10 }}>
                  No truck assigned yet. Your fleet assigns one from the MiTow console.
                </Text>
              )}
            </Card>

            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
              <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
                Fleet
              </Text>
              <InfoRow label="Fleet" value={me.fleet?.name ?? 'Independent partner'} />
            </Card>

            <Text style={{ fontSize: 13, lineHeight: 19, color: INK_SOFT, paddingHorizontal: 4 }}>
              Your truck and its papers are set by your fleet from the MiTow console. Contact MiTow
              support from Help & Support for anything else.
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

function capitalise(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: HAIRLINE,
      }}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>{label}</Text>
      <Text style={{ fontSize: 15, lineHeight: 21 }}>{value}</Text>
    </View>
  );
}

function EditableRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: HAIRLINE,
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>{label}</Text>
      {children}
    </View>
  );
}

function PersonalInformationSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      <Skeleton width="100%" height={200} radius={20} />
      <Skeleton width="100%" height={140} radius={20} />
      <Skeleton width="100%" height={80} radius={20} />
    </View>
  );
}
