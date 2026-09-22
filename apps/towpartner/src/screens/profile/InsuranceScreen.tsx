import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, ErrorState, Screen, Skeleton, Text } from '@towing/ui';
import type { DriverTruck } from '@towing/api-contracts';
import { RefreshCw, TriangleAlert } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { useDriverTruck } from '@/features/profile/api/profile.queries';
import type { RootStackParamList } from '@/navigation/types';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';

/**
 * The truck's papers, read-only.
 *
 * NOT EDITABLE, deliberately. Insurance, RC, PUC and permit are renewed by the
 * fleet from the MiTow console (or by MiTow support for an independent driver);
 * a driver editing their own dates would not change what the platform sees.
 *
 * Insurance leads the list because it is the paper that stops the work: an
 * expired or missing insurance is what makes the truck `non_compliant`, and a
 * `non_compliant` truck is exactly why the driver stops receiving offers. The
 * banner says that plainly rather than leaving a red chip to imply it.
 */
export function InsuranceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, isPending, isError, refetch } = useDriverTruck();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 28 }}>
      <DriverHeader
        leading="back"
        title="Insurance & papers"
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 3, gap: 12 }}>
        {isPending ? (
          <InsuranceSkeleton />
        ) : isError || !data ? (
          <ErrorState
            title="Couldn't load your papers"
            onRetry={() => refetch()}
            icon={RefreshCw}
          />
        ) : data.truck === null ? (
          <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
            <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
              No truck yet
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: INK_SOFT, paddingVertical: 10 }}>
              Your fleet assigns a truck from the MiTow console. Its insurance and papers appear
              here once it does.
            </Text>
          </Card>
        ) : (
          <>
            {needsAttention(data) ? <ComplianceBanner fleetName={data.fleetName} /> : null}

            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
              <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
                Your truck
              </Text>
              <InfoRow label="Plate" value={data.truck.plate} />
              <InfoRow
                label="Make & model"
                value={[data.truck.make, data.truck.model].filter(Boolean).join(' ') || '—'}
              />
              <InfoRow
                label="Type"
                value={data.truck.vehicleClass === 'flatbed' ? 'Flatbed' : 'Wheel-lift'}
              />
            </Card>

            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE }}>
              <Text weight="medium" style={{ fontSize: 15, lineHeight: 21, marginBottom: 4 }}>
                Papers
              </Text>
              {data.documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} />
              ))}
            </Card>

            <Text style={{ fontSize: 13, lineHeight: 19, color: INK_SOFT, paddingHorizontal: 4 }}>
              {data.fleetName
                ? `${data.fleetName} renews these papers from the MiTow console. Contact them, or MiTow support, if a date looks wrong.`
                : 'Contact MiTow support from Help & Support if a date looks wrong.'}
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

function needsAttention(data: DriverTruck): boolean {
  if (data.truck?.status === 'non_compliant') return true;
  return data.documents.some((doc) => doc.status === 'expired' || doc.status === 'missing');
}

function ComplianceBanner({ fleetName }: { fleetName: string | null }) {
  return (
    <Card
      padding={18}
      style={{ borderRadius: 20, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <TriangleAlert size={18} color="#DC2626" />
        <Text weight="medium" style={{ fontSize: 15, lineHeight: 21 }}>
          This truck can't take jobs
        </Text>
      </View>
      <Text style={{ fontSize: 14, lineHeight: 20, color: INK_SOFT }}>
        MiTow stops sending offers while a paper is expired or missing.{' '}
        {fleetName
          ? 'Your fleet renews it from the MiTow console.'
          : 'Contact MiTow support from Help & Support to get it renewed.'}
      </Text>
    </Card>
  );
}

const DOC_LABELS: Record<DriverTruck['documents'][number]['docType'], string> = {
  insurance: 'Insurance',
  rc: 'Registration (RC)',
  puc: 'Pollution (PUC)',
  permit: 'Permit',
};

const CHIP_STYLES: Record<
  DriverTruck['documents'][number]['status'],
  { label: string; color: string; background: string }
> = {
  valid: { label: 'Valid', color: '#047857', background: '#ECFDF5' },
  expiring: { label: 'Expiring soon', color: '#B45309', background: '#FFFBEB' },
  expired: { label: 'Expired', color: '#B91C1C', background: '#FEF2F2' },
  missing: { label: 'Not uploaded', color: '#4B5563', background: '#F3F4F6' },
};

function DocumentRow({ doc }: { doc: DriverTruck['documents'][number] }) {
  const chip = CHIP_STYLES[doc.status];
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
      <Text style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>
        {DOC_LABELS[doc.docType]}
      </Text>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: chip.background,
          }}
        >
          <Text style={{ fontSize: 12, lineHeight: 16, color: chip.color }}>{chip.label}</Text>
        </View>
        <Text style={{ fontSize: 12, lineHeight: 16, color: INK_SOFT }}>
          {expiryLine(doc)}
        </Text>
      </View>
    </View>
  );
}

function expiryLine(doc: DriverTruck['documents'][number]): string {
  if (doc.status === 'missing') return 'Not uploaded yet';
  if (!doc.expiresAt) return 'No expiry recorded';
  const date = new Date(doc.expiresAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return doc.status === 'expired' ? `Expired on ${date}` : `Valid until ${date}`;
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

function InsuranceSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      <Skeleton width="100%" height={120} radius={20} />
      <Skeleton width="100%" height={140} radius={20} />
      <Skeleton width="100%" height={240} radius={20} />
    </View>
  );
}
