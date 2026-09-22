import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, ErrorState, Screen, Skeleton, Text } from '@towing/ui';
import { RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { useDriverMe } from '@/features/profile/api/profile.queries';
import type { RootStackParamList } from '@/navigation/types';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';

/**
 * The driver's own record, read-only.
 *
 * NOT EDITABLE, deliberately. Name, mobile and truck are the identity the
 * platform pays against and the fleet assigns — a driver editing their own
 * plate would break the assignment the fleet console made. The last line says
 * where to go instead, which is the only honest answer this screen can give.
 */
export function PersonalInformationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: me, isPending, isError, refetch } = useDriverMe();

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
              <InfoRow label="Name" value={me.name ?? '—'} />
              <InfoRow label="Mobile" value={me.mobile} />
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
              To change these details, contact MiTow support from Help & Support.
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

function PersonalInformationSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      <Skeleton width="100%" height={200} radius={20} />
      <Skeleton width="100%" height={140} radius={20} />
      <Skeleton width="100%" height={80} radius={20} />
    </View>
  );
}
