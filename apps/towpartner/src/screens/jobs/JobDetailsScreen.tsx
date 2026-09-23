import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, ErrorState, Screen, Skeleton, StatusBadge, Text } from '@towing/ui';
import { MapPin, RefreshCw } from '@/icons';
import { DriverHeader } from '@/components/DriverHeader';
import { Pill } from '@/components/Pill';
import { useJobDetail } from '@/features/offers/api/offers.queries';
import { SERVICE_ICON, isAtTheSpot, serviceLabel } from '@/features/offers/serviceLabels';
import { JOB_STATUS_META, statusBadgeTone } from '@/features/jobs/statusMeta';
import { driverColors } from '@/theme/driverColors';
import { formatPaise } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';
import { yourEarningsText } from '@/features/offers/yourEarnings';

const HAIRLINE = '#E5E7EB';
const INK_SOFT = '#4B5563';

/**
 * A past (or current) job, opened from Jobs or Home by booking id.
 *
 * READ-ONLY, deliberately. Everything actionable about a live job lives on
 * `AssignedJobScreen` — this screen exists so a driver can look back at a
 * completed trip and answer the two questions support actually gets: "what did
 * I earn on this?" and "where was it?". The earnings breakdown is here in full
 * because the number a driver remembers is the net, and the number they query
 * is the commission.
 */
export function JobDetailsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'JobDetails'>>();
  const jobId = route.params?.jobId;

  const { data: job, isPending, isError, refetch } = useJobDetail(jobId ?? '');

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ paddingBottom: 28 }}>
      <DriverHeader
        leading="back"
        title="Job Details"
        subtitle={job ? job.reference : 'Trip summary'}
        subtitleSize={14}
        showBell={false}
        onLeading={() => navigation.goBack()}
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 3, gap: 12 }}>
        {!jobId ? (
          <ErrorState
            title="Couldn't load this job"
            body="This job is missing its booking id."
            icon={RefreshCw}
          />
        ) : isPending ? (
          <JobDetailsSkeleton />
        ) : isError || !job ? (
          <ErrorState title="Couldn't load this job" onRetry={() => refetch()} icon={RefreshCw} />
        ) : (
          <>
            {/* Status + service. */}
            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE, gap: 10 }}>
              <StatusBadge
                label={JOB_STATUS_META[job.status].label}
                tone={statusBadgeTone(job.status)}
                pill
                icon={JOB_STATUS_META[job.status].icon}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {React.createElement(SERVICE_ICON[job.serviceType], {
                  size: 14,
                  color: INK_SOFT,
                  strokeWidth: 2,
                })}
                <Text style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>
                  {serviceLabel(job)}
                </Text>
              </View>
            </Card>

            {/* Route, as a timeline. At-the-spot jobs have no drop leg. */}
            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 6,
                    marginTop: 7,
                    backgroundColor: driverColors.online,
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text color="secondary" style={{ fontSize: 12, lineHeight: 16 }}>
                    {isAtTheSpot(job) ? 'Service location' : 'Pickup'}
                  </Text>
                  <Text style={{ fontSize: 16, lineHeight: 23 }}>
                    {job.pickupAddress ?? 'Location shared by the customer'}
                  </Text>
                </View>
              </View>

              {isAtTheSpot(job) ? (
                <Text style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>
                  Roadside service — done where the car is, no towing.
                </Text>
              ) : (
                <>
                  <View
                    style={{
                      height: 18,
                      width: 1,
                      marginLeft: 5,
                      borderLeftWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: '#9CA3AF',
                    }}
                  />

                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <MapPin
                      size={13}
                      color={driverColors.chip.red.fg}
                      strokeWidth={2.4}
                      style={{ marginTop: 6 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text color="secondary" style={{ fontSize: 12, lineHeight: 16 }}>
                        Drop
                      </Text>
                      <Text style={{ fontSize: 16, lineHeight: 23 }}>
                        {job.dropAddress ?? 'No destination set'}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {job.distanceKm !== null ? (
                <View style={{ flexDirection: 'row', paddingTop: 2 }}>
                  <Pill
                    label={`${job.distanceKm} km`}
                    bg="#F3F4F6"
                    fg="#374151"
                    radius={7}
                    textSize={13}
                  />
                </View>
              ) : null}
            </Card>

            {/* Earnings breakdown. */}
            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE, gap: 10 }}>
              <Text weight="medium" style={{ fontSize: 15, lineHeight: 21 }}>
                Earnings
              </Text>
              <EarningsRow label="Fare" value={formatPaise(job.earnings.grossPaise)} />
              <EarningsRow
                label={`Commission${
                  job.earnings.commissionPct === null ? '' : ` (${job.earnings.commissionPct}%)`
                }`}
                value={`−${formatPaise(job.earnings.commissionPaise)}`}
              />
              <View style={{ height: 1, backgroundColor: HAIRLINE }} />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text weight="medium" style={{ fontSize: 15, lineHeight: 21 }}>
                  You earned
                </Text>
                <Text
                  weight="bold"
                  tabular
                  style={{ fontSize: 18, lineHeight: 24, color: driverColors.online }}
                >
                  {yourEarningsText(job.earnings)}
                </Text>
              </View>
            </Card>

            {/* Payment. */}
            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE, gap: 10 }}>
              <Text weight="medium" style={{ fontSize: 15, lineHeight: 21 }}>
                Payment
              </Text>
              <InfoRow label="Paid by" value={paymentMethodLabel(job.payment)} />
              {job.payment.discountPaise > 0 ? (
                <InfoRow
                  label="Customer discount"
                  value={formatPaise(job.payment.discountPaise)}
                />
              ) : null}
            </Card>

            {/* Customer. */}
            <Card padding={18} style={{ borderRadius: 20, borderColor: HAIRLINE, gap: 6 }}>
              <Text weight="medium" style={{ fontSize: 16, lineHeight: 23 }}>
                {job.customerName ?? 'Customer'}
              </Text>
              {job.note ? (
                <Text style={{ fontSize: 14, lineHeight: 20, color: INK_SOFT }}>{job.note}</Text>
              ) : null}
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}

function paymentMethodLabel(payment: {
  method: 'cash' | 'online' | null;
  status: string;
}): string {
  if (payment.status !== 'paid') return 'Not paid yet';
  if (payment.method === 'cash') return 'Cash';
  if (payment.method === 'online') return 'In the app';
  return 'Not chosen yet';
}

function EarningsRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 14, lineHeight: 20, color: INK_SOFT }}>{label}</Text>
      <Text tabular style={{ fontSize: 14, lineHeight: 20 }}>
        {value}
      </Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 14, lineHeight: 20, color: INK_SOFT }}>{label}</Text>
      <Text style={{ fontSize: 14, lineHeight: 20 }}>{value}</Text>
    </View>
  );
}

function JobDetailsSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      <Skeleton width="100%" height={104} radius={20} />
      <Skeleton width="100%" height={140} radius={20} />
      <Skeleton width="100%" height={120} radius={20} />
    </View>
  );
}
