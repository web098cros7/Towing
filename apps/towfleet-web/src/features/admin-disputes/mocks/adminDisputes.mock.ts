import type { AdminDispute, AdminDisputeDetail } from '@towing/api-contracts';
import { adminBookingsMock } from '../../admin-bookings/mocks/adminBookings.mock';

const HOUR = 60 * 60 * 1000;
const iso = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * HOUR).toISOString();

/**
 * W8's dispute queue fixture.
 *
 * ONE ROW PER EXIT-ORIGIN the resolver enforces, so the drawer's five exits
 * are all reachable in mocks-on previews without the API:
 *
 *  - d1 opened from `paid`   → uphold_charge / full_refund / partial_refund
 *  - d2 opened from `completed` → complete_and_charge / cancel_no_charge
 *  - d3 RESOLVED with a partial refund, so the resolved state renders
 *  - d4 an OPEN dispute on a booking whose status is already `disputed`
 *  - d5 opened from `completed` on the other unpaid row
 *
 * Each row embeds its booking context from the SAME bookings fixture the list
 * uses — two fixtures, one truth.
 */

/** d1 — the open dispute on the paid booking; the spec's canonical detail. */
export const MOCK_DISPUTE_OPEN = 'a1a1a1a1-1111-4111-8111-111111111111';

function bookingContext(bookingId: string) {
  const booking = adminBookingsMock.find((row) => row.id === bookingId);
  if (!booking) throw new Error(`Booking fixture ${bookingId} missing for dispute mock`);
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    totalPaise: booking.totalPaise,
    customerName: booking.userName,
    driverName: booking.driverName,
    createdAt: booking.createdAt,
  };
}

export const adminDisputesMock: AdminDispute[] = [
  {
    id: MOCK_DISPUTE_OPEN,
    bookingId: '44444444-4444-4444-8444-444444444444',
    status: 'open',
    reasonCode: 'overcharge',
    description:
      'Customer disputes the waiting charge: says the driver arrived late and still billed 18 minutes of waiting.',
    openedByType: 'admin',
    openedById: null,
    openedFromStatus: 'paid',
    assignedAdminId: null,
    assignedAdminName: null,
    resolution: null,
    liability: null,
    refundId: null,
    refundAmountPaise: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(6),
    updatedAt: iso(6),
    booking: bookingContext('44444444-4444-4444-8444-444444444444'),
  },
  {
    id: 'a2a2a2a2-2222-4222-8222-222222222222',
    bookingId: '33333333-3333-4333-8333-333333333333',
    status: 'open',
    reasonCode: 'service_not_completed',
    description:
      'Customer claims the tow was left halfway; the driver marked the job complete. Payment already failed, so this resolves before settlement.',
    openedByType: 'admin',
    openedById: null,
    openedFromStatus: 'completed',
    assignedAdminId: null,
    assignedAdminName: null,
    resolution: null,
    liability: null,
    refundId: null,
    refundAmountPaise: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(20),
    updatedAt: iso(19),
    booking: bookingContext('33333333-3333-4333-8333-333333333333'),
  },
  {
    id: 'a3a3a3a3-3333-4333-8333-333333333333',
    bookingId: '77777777-7777-4777-8777-777777777777',
    status: 'resolved',
    reasonCode: 'overcharge',
    description: 'Billed for 9.8 km on a 4.2 km trip.',
    openedByType: 'admin',
    openedById: null,
    openedFromStatus: 'paid',
    assignedAdminId: '1c000000-0000-4000-8000-000000000001',
    assignedAdminName: 'Rohit Menon',
    resolution: 'partial_refund',
    liability: 'driver',
    refundId: 'e0000000-0000-4000-8000-000000000001',
    refundAmountPaise: 50_000,
    resolutionNote: 'Distance log reviewed: refunded the overcharged distance, debited the driver.',
    resolvedBy: '1c000000-0000-4000-8000-000000000001',
    resolvedAt: iso(80),
    createdAt: iso(92),
    updatedAt: iso(80),
    booking: bookingContext('77777777-7777-4777-8777-777777777777'),
  },
  {
    id: 'a4a4a4a4-4444-4444-8444-444444444444',
    bookingId: '55555555-5555-4555-8555-555555555555',
    status: 'under_review',
    reasonCode: 'vehicle_damage',
    description: 'Customer reports a dent on the rear bumper noticed after unloading.',
    openedByType: 'admin',
    openedById: null,
    openedFromStatus: 'in_progress',
    assignedAdminId: '1c000000-0000-4000-8000-000000000001',
    assignedAdminName: 'Rohit Menon',
    resolution: null,
    liability: null,
    refundId: null,
    refundAmountPaise: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(3),
    updatedAt: iso(2),
    booking: bookingContext('55555555-5555-4555-8555-555555555555'),
  },
  {
    id: 'a5a5a5a5-5555-4555-8555-555555555555',
    bookingId: '88888888-8888-4888-8888-888888888888',
    status: 'open',
    reasonCode: 'payment_issue',
    description: 'Customer says the UPI debit went through but the app still shows payment due.',
    openedByType: 'admin',
    openedById: null,
    openedFromStatus: 'completed',
    assignedAdminId: null,
    assignedAdminName: null,
    resolution: null,
    liability: null,
    refundId: null,
    refundAmountPaise: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(28),
    updatedAt: iso(28),
    booking: bookingContext('88888888-8888-4888-8888-888888888888'),
  },
];

/** Evidence rides the detail only — the queue never needs the presigned URLs. */
export function adminDisputeDetailMock(disputeId: string): AdminDisputeDetail {
  const dispute = adminDisputesMock.find((row) => row.id === disputeId);
  if (!dispute) throw new Error(`Mock dispute ${disputeId} does not exist`);

  const evidence =
    disputeId === MOCK_DISPUTE_OPEN
      ? [
          {
            id: 'b0000000-0000-4000-8000-000000000001',
            kind: 'photo' as const,
            note: 'Screenshot of the fare breakdown the customer sent',
            uploadedByType: 'admin' as const,
            uploadedById: null,
            createdAt: iso(5),
            url: 'https://mock.towing.local/dispute-evidence/fare-screenshot.png',
          },
          {
            id: 'b0000000-0000-4000-8000-000000000002',
            kind: 'document' as const,
            note: 'Driver waiting-time log export',
            uploadedByType: 'admin' as const,
            uploadedById: null,
            createdAt: iso(4),
            url: 'https://mock.towing.local/dispute-evidence/waiting-log.pdf',
          },
        ]
      : [];

  return { ...dispute, evidence };
}
