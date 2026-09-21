'use client';

import { Card, CardContent, CardHeader, CardTitle, StatusChip } from '@towing/web-ui';
import type {
  AdminBookingDetail,
  AdminBookingPayment,
  AdminBookingRefund,
} from '@towing/api-contracts';
import { formatPaise } from '@/lib/money';
import { NotesPanel } from '@/features/admin-notes/components/NotesPanel';
import { BOOKING_STATUS_TONES } from './bookingStatus';

const at = (value: string | null): string =>
  value
    ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function paymentStatusTone(status: AdminBookingPayment['status']) {
  if (status === 'captured') return 'success' as const;
  if (status === 'failed') return 'error' as const;
  if (status === 'refunded') return 'neutral' as const;
  return 'warning' as const;
}

/**
 * §9.4.7's detail: parties, route, the FROZEN fare breakdown, dispatch state,
 * the status timeline with its admin actors, payments, refunds, and W21's
 * notes panel. Every mutating control lives in `BookingActions` — this view's
 * job is to make an operator's next click obvious and honest.
 *
 * The numbers here are snapshot values, not recomputations: §3.4 locks the
 * fare at confirm, and this screen showing a fresh commission calculation
 * would be the first place that promise breaks.
 */
export function BookingDetail({ detail }: { detail: AdminBookingDetail }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {detail.openDisputeId ? (
        <Card className="xl:col-span-2">
          <CardContent className="p-4" data-testid="booking-dispute-banner">
            <p className="text-sm">
              This booking has an <strong>open dispute</strong>. Money-bearing endings are made from
              the Disputes queue — cancelling from this screen is refused while it is open.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Parties</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Row label="Customer">
            {detail.userName ?? '—'}
            <span className="block text-xs text-text-secondary">{detail.userMobile}</span>
          </Row>
          {detail.contactName ? (
            <Row label="Booking for">
              {detail.contactName}
              <span className="block text-xs text-text-secondary">{detail.contactMobile}</span>
            </Row>
          ) : null}
          <Row label="Driver">{detail.driverName ?? 'Unassigned'}</Row>
          <Row label="Fleet">{detail.fleetName ?? '—'}</Row>
          <Row label="Zone">{detail.zoneName ?? '—'}</Row>
          {detail.unableReason ? <Row label="Unable reason">{detail.unableReason}</Row> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trip</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Row label="Pickup">{detail.pickupAddress ?? '—'}</Row>
          <Row label="Drop">{detail.dropAddress ?? '—'}</Row>
          <Row label="Distance">{detail.distanceKm !== null ? `${detail.distanceKm} km` : '—'}</Row>
          <Row label="Created">{at(detail.createdAt)}</Row>
          <Row label="Completed">{at(detail.completedAt)}</Row>
          <Row label="Paid">{at(detail.paidAt)}</Row>
          {detail.status === 'cancelled' ? (
            <>
              <Row label="Cancelled by">{detail.cancelledBy ?? '—'}</Row>
              <Row label="Cancellation fee">
                {formatPaise(detail.cancellationFeePaise)}
                <span className="block text-xs text-text-secondary">
                  driver compensation {formatPaise(detail.driverCompensationPaise)}
                </span>
              </Row>
              {detail.cancellationReason ? (
                <Row label="Reason">{detail.cancellationReason}</Row>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fare breakdown</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Row label="Base fare">{formatPaise(detail.breakdown.baseFarePaise)}</Row>
          <Row label="Distance">{formatPaise(detail.breakdown.distanceChargePaise)}</Row>
          {detail.breakdown.nightChargePaise > 0 ? (
            <Row label="Night">{formatPaise(detail.breakdown.nightChargePaise)}</Row>
          ) : null}
          {detail.breakdown.highwayChargePaise > 0 ? (
            <Row label="Highway">{formatPaise(detail.breakdown.highwayChargePaise)}</Row>
          ) : null}
          {detail.breakdown.waitingChargePaise > 0 ? (
            <Row label="Waiting">{formatPaise(detail.breakdown.waitingChargePaise)}</Row>
          ) : null}
          {detail.breakdown.surgePaise > 0 ? (
            <Row label="Surge">{formatPaise(detail.breakdown.surgePaise)}</Row>
          ) : null}
          {detail.breakdown.discountPaise > 0 ? (
            <Row label="Discount">−{formatPaise(detail.breakdown.discountPaise)}</Row>
          ) : null}
          <Row label={`Tax (${detail.breakdown.taxPct}%)`}>
            {formatPaise(detail.breakdown.taxAmountPaise)}
          </Row>
          <div className="my-2 border-t border-border" />
          <Row label="Total">
            <span data-testid="booking-total">{formatPaise(detail.breakdown.totalPaise)}</span>
          </Row>
          <Row
            label={`Commission${detail.breakdown.commissionPct !== null ? ` (${detail.breakdown.commissionPct}% · band ${detail.breakdown.commissionBand})` : ''}`}
          >
            {formatPaise(detail.breakdown.commissionPaise)}
          </Row>
          <Row label="Driver payout">{formatPaise(detail.breakdown.driverPayoutPaise)}</Row>
          {detail.waitingFreeMinutes !== null ? (
            <Row label="Waiting policy">
              {detail.waitingFreeMinutes} min free, {formatPaise(detail.waitingPerMinutePaise ?? 0)}
              /min
            </Row>
          ) : null}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="flex flex-col gap-2" data-testid="booking-timeline">
            {detail.timeline.map((entry, index) => (
              <li
                key={`${entry.status}-${entry.at}-${index}`}
                className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 text-sm last:border-b-0"
              >
                <StatusChip status={entry.status} tone={BOOKING_STATUS_TONES[entry.status]} />
                <span className="text-text-secondary capitalize">{entry.actor}</span>
                {entry.note ? <span className="text-text-tertiary">— {entry.note}</span> : null}
                <span className="ml-auto text-xs text-text-tertiary">{at(entry.at)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {detail.payments.length === 0 ? (
            <p className="text-sm text-text-tertiary" data-testid="booking-payments-empty">
              No payment attempts yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="booking-payments">
              {detail.payments.map((payment) => (
                <li key={payment.id} className="rounded-card border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="capitalize">{payment.purpose.replace(/_/g, ' ')}</span>
                    <StatusChip status={payment.status} tone={paymentStatusTone(payment.status)} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-text-secondary">
                    <span>
                      {formatPaise(payment.amountPaise)}
                      {payment.method ? ` · ${payment.method.toUpperCase()}` : ''}
                    </span>
                    <span>
                      {payment.refundedAmountPaise > 0
                        ? `refunded ${formatPaise(payment.refundedAmountPaise)}`
                        : at(payment.capturedAt)}
                    </span>
                  </div>
                  {payment.failureReason ? (
                    <p className="mt-1 text-xs text-error">{payment.failureReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Refunds</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {detail.refunds.length === 0 ? (
            <p className="text-sm text-text-tertiary" data-testid="booking-refunds-empty">
              Nothing refunded on this booking.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="booking-refunds">
              {detail.refunds.map((refund: AdminBookingRefund) => (
                <li key={refund.id} className="rounded-card border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="capitalize">{refund.kind} refund</span>
                    <StatusChip
                      status={refund.status}
                      tone={
                        refund.status === 'processed'
                          ? 'success'
                          : refund.status === 'failed'
                            ? 'error'
                            : 'warning'
                      }
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-text-secondary">
                    <span>{formatPaise(refund.amountPaise)}</span>
                    <span>{at(refund.processedAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">{refund.reason}</p>
                  {refund.disputeId ? (
                    <p className="mt-1 text-xs text-text-tertiary">
                      From dispute {refund.disputeId.slice(0, 8)}…
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Internal notes</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <NotesPanel subjectType="booking" subjectId={detail.id} />
        </CardContent>
      </Card>
    </div>
  );
}
