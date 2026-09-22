'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BellRing, FileText, RefreshCw, Scale, Shuffle, Undo2, Wrench } from 'lucide-react';
import { Button } from '@towing/web-ui';
import type { AdminBookingDetail } from '@towing/api-contracts';
import { useAdminCan } from '@/components/admin/Can';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useCancelBooking,
  useReassignBooking,
  useRecheckPayment,
  useRemindPayment,
  useTransitionBooking,
} from '../api/adminBookings.mutations';
import { useAdminBookingInvoice } from '../api/adminBookings.queries';
import { useOpenDispute } from '@/features/admin-disputes/api/adminDisputes.mutations';
import { BookingCancelDialog } from './BookingCancelDialog';
import { BookingReassignDialog } from './BookingReassignDialog';
import { BookingOverrideDialog } from './BookingOverrideDialog';
import { OpenDisputeDialog } from './OpenDisputeDialog';
import { CANCELABLE_STATUSES, DISPUTABLE_STATUSES, REASSIGNABLE_STATUSES } from './bookingStatus';

/**
 * Every intervention W8 puts on a booking, in one row, each gated twice: by
 * the operator's permissions (the same `ROLE_PERMISSIONS` the server enforces)
 * and by the booking's own state. What is hidden here is also refused
 * server-side — hiding is UX, never the control.
 *
 * The §14.2 pair (Recheck, Remind) is not a general "chase payment" button: it
 * appears only on a COMPLETED booking whose booking payment never captured —
 * the unpaid intervention the milestone exists for.
 */
export function BookingActions({ detail }: { detail: AdminBookingDetail }) {
  const can = useAdminCan();
  const toast = useToast();

  const cancel = useCancelBooking(detail.id);
  const reassign = useReassignBooking(detail.id);
  const override = useTransitionBooking(detail.id);
  const recheck = useRecheckPayment(detail.id);
  const remind = useRemindPayment(detail.id);
  const openDispute = useOpenDispute(detail.id);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [wantsInvoice, setWantsInvoice] = useState(false);

  const invoice = useAdminBookingInvoice(detail.id, wantsInvoice);

  const cancelable = CANCELABLE_STATUSES.includes(detail.status);
  const reassignable = REASSIGNABLE_STATUSES.includes(detail.status);
  const disputable = DISPUTABLE_STATUSES.includes(detail.status) && !detail.openDisputeId;

  const bookingPayment = detail.payments.find((payment) => payment.purpose === 'booking');
  const unpaidIntervention = detail.status === 'completed' && bookingPayment?.status !== 'captured';

  const runRecheck = async () => {
    try {
      const result = await recheck.mutateAsync();
      toast(
        result.settled
          ? 'Payment settled — the booking is marked paid.'
          : 'Still unpaid. The gateway had nothing new to settle.',
        result.settled ? 'success' : 'info',
      );
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const runRemind = async () => {
    try {
      const result = await remind.mutateAsync();
      toast(
        result.sent
          ? 'Reminder sent to the customer.'
          : 'A reminder was already sent today — one per booking per day.',
        result.sent ? 'success' : 'info',
      );
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {cancelable && can('booking.cancel') ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCancelOpen(true)}
          data-testid="booking-action-cancel"
        >
          <Undo2 className="size-4" /> Cancel
        </Button>
      ) : null}

      {reassignable && can('booking.reassign') ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReassignOpen(true)}
          data-testid="booking-action-reassign"
        >
          <Shuffle className="size-4" /> Reassign
        </Button>
      ) : null}

      {can('booking.override') && !['paid', 'cancelled', 'disputed'].includes(detail.status) ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOverrideOpen(true)}
          data-testid="booking-action-override"
        >
          <Wrench className="size-4" /> Override
        </Button>
      ) : null}

      {disputable && can('dispute.handle') ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDisputeOpen(true)}
          data-testid="booking-action-dispute"
        >
          <Scale className="size-4" /> Open dispute
        </Button>
      ) : null}

      {unpaidIntervention && can('finance.summary') ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runRecheck()}
            disabled={recheck.isPending}
            data-testid="booking-action-recheck"
          >
            <RefreshCw className="size-4" /> {recheck.isPending ? 'Rechecking…' : 'Recheck payment'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runRemind()}
            disabled={remind.isPending}
            data-testid="booking-action-remind"
          >
            <BellRing className="size-4" /> {remind.isPending ? 'Sending…' : 'Remind customer'}
          </Button>
        </>
      ) : null}

      {detail.status === 'paid' ? (
        invoice.data ? (
          <a
            href={invoice.data.url}
            target="_blank"
            rel="noreferrer"
            data-testid="booking-invoice-link"
            className="text-sm font-medium text-brand underline underline-offset-2"
          >
            Download invoice
          </a>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWantsInvoice(true)}
            disabled={invoice.isFetching}
            data-testid="booking-action-invoice"
          >
            <FileText className="size-4" /> {invoice.isFetching ? 'Minting…' : 'View invoice'}
          </Button>
        )
      ) : null}

      {detail.openDisputeId ? (
        <Link
          href={`/admin/disputes?dispute=${detail.openDisputeId}`}
          className="text-sm font-medium text-brand underline underline-offset-2"
          data-testid="booking-open-dispute-link"
        >
          View open dispute
        </Link>
      ) : null}

      <BookingCancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        bookingCode={detail.code}
        isPending={cancel.isPending}
        onConfirm={(body) => cancel.mutateAsync(body)}
      />
      <BookingReassignDialog
        open={reassignOpen}
        onClose={() => setReassignOpen(false)}
        bookingCode={detail.code}
        currentDriverName={detail.driverName}
        isPending={reassign.isPending}
        onConfirm={(body) => reassign.mutateAsync(body)}
      />
      <BookingOverrideDialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        bookingCode={detail.code}
        currentStatus={detail.status}
        isPending={override.isPending}
        onConfirm={(body) => override.mutateAsync(body)}
      />
      <OpenDisputeDialog
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        bookingCode={detail.code}
        openedFromStatus={detail.status}
        isPending={openDispute.isPending}
        onConfirm={(body) => openDispute.mutateAsync(body)}
      />
    </div>
  );
}
