import type {
  AdminBookingCancelBody,
  AdminBookingCancelResponse,
  AdminBookingDetail,
  AdminBookingInvoice,
  AdminBookingReassignBody,
  AdminBookingReassignResponse,
  AdminBookingRecheckResponse,
  AdminBookingRemindResponse,
  AdminBookingsQuery,
  AdminBookingsResponse,
  AdminBookingTransitionBody,
  AdminBookingTransitionResponse,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import {
  adminBookingDetailMock,
  adminBookingInvoiceMock,
  adminBookingsMock,
} from '../mocks/adminBookings.mock';

/**
 * W8's bookings API — the only place the console talks to the backend.
 *
 * The CSV export is a URL, not a fetch: the browser must download it with the
 * session cookie attached, which only the BFF proxy (`/api/admin-proxy/...`)
 * can do — the same shape the fleet console's job/report exports use, and the
 * reason the proxy relays `content-disposition`.
 */
export interface AdminBookingsDataSource {
  list(query: AdminBookingsQuery): Promise<AdminBookingsResponse>;
  detail(bookingId: string): Promise<AdminBookingDetail>;
  invoice(bookingId: string): Promise<AdminBookingInvoice>;
  cancel(bookingId: string, body: AdminBookingCancelBody): Promise<AdminBookingCancelResponse>;
  reassign(
    bookingId: string,
    body: AdminBookingReassignBody,
  ): Promise<AdminBookingReassignResponse>;
  transition(
    bookingId: string,
    body: AdminBookingTransitionBody,
  ): Promise<AdminBookingTransitionResponse>;
  /** §14.2 — re-poll the gateway for this booking's payment. */
  recheckPayment(bookingId: string): Promise<AdminBookingRecheckResponse>;
  /** §14.2 — nudge the customer; deduped per booking per IST day by the API. */
  remindPayment(bookingId: string): Promise<AdminBookingRemindResponse>;
  exportCsvUrl(query: AdminBookingsQuery): string;
}

function toQueryString(query: AdminBookingsQuery): string {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  // Repeated `status=` rather than `status[]=`: the API's preprocessor accepts
  // either, and the bare form survives the BFF proxy's URL handling.
  for (const status of query.status ?? []) params.append('status', status);
  for (const [key, value] of Object.entries({
    from: query.from,
    to: query.to,
    userId: query.userId,
    driverId: query.driverId,
    fleetId: query.fleetId,
    zoneId: query.zoneId,
    band: query.band,
    serviceType: query.serviceType,
    q: query.q,
  })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/**
 * The message every mock mutation throws. Deliberate: a mock that "succeeds"
 * at cancelling a booking proves the mock resolves, nothing else — the same
 * reasoning `admin-kyc.spec.ts` writes into its header. An honest error beats
 * a fabricated success on a screen whose buttons move money and dispatch jobs.
 */
const MOCKS_NEED_BACKEND =
  'Mocks are on — cancel/reassign/override need the real backend. Set NEXT_PUBLIC_USE_MOCKS=false.';

const mockSource: AdminBookingsDataSource = {
  list: async (query) => {
    const all = await resolveMock(env.mockAdminBookingsState, adminBookingsMock, []);
    const filtered = all
      .filter((row) => {
        if (query.status && query.status.length > 0 && !query.status.includes(row.status)) {
          return false;
        }
        if (query.serviceType && row.serviceType !== query.serviceType) return false;
        if (query.fleetId && row.fleetId !== query.fleetId) return false;
        if (query.zoneId && row.zoneId !== query.zoneId) return false;
        if (query.from && row.createdAt.slice(0, 10) < query.from) return false;
        if (query.to && row.createdAt.slice(0, 10) > query.to) return false;
        if (query.q) {
          const probe = query.q.toLowerCase();
          const haystack = [row.code, row.userName ?? '', row.userMobile, row.pickupAddress ?? '']
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(probe)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (query.page - 1) * query.limit;
    return {
      items: filtered.slice(start, start + query.limit),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
    };
  },

  detail: async (bookingId) =>
    resolveMock(
      env.mockAdminBookingsState,
      adminBookingDetailMock(bookingId),
      adminBookingDetailMock(bookingId),
    ),

  invoice: async () => {
    await mockDelay();
    return adminBookingInvoiceMock;
  },

  cancel: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  reassign: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  transition: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  recheckPayment: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },
  remindPayment: async () => {
    await mockDelay();
    throw new Error(MOCKS_NEED_BACKEND);
  },

  exportCsvUrl: () => '#',
};

const restSource: AdminBookingsDataSource = {
  list: (query) => adminApiFetch<AdminBookingsResponse>(`bookings?${toQueryString(query)}`),

  detail: (bookingId) => adminApiFetch<AdminBookingDetail>(`bookings/${bookingId}`),

  invoice: (bookingId) => adminApiFetch<AdminBookingInvoice>(`bookings/${bookingId}/invoice`),

  // No Idempotency-Key on any of these: each is guarded by the booking's own
  // status (cancel refuses post-payment states, reassign refuses a missing
  // driver, the override allowlist is closed), so a replayed request is a 409
  // rather than a second effect. Operator refunds (W9) are the exception that
  // takes a key, because a refund has no such guard.
  cancel: (bookingId, body) =>
    adminApiFetch<AdminBookingCancelResponse>(`bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reassign: (bookingId, body) =>
    adminApiFetch<AdminBookingReassignResponse>(`bookings/${bookingId}/reassign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  transition: (bookingId, body) =>
    adminApiFetch<AdminBookingTransitionResponse>(`bookings/${bookingId}/transition`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  recheckPayment: (bookingId) =>
    adminApiFetch<AdminBookingRecheckResponse>(`bookings/${bookingId}/payment/recheck`, {
      method: 'POST',
    }),

  remindPayment: (bookingId) =>
    adminApiFetch<AdminBookingRemindResponse>(`bookings/${bookingId}/payment/remind`, {
      method: 'POST',
    }),

  exportCsvUrl: (query) => `/api/admin-proxy/bookings/export.csv?${toQueryString(query)}`,
};

export const adminBookingsDataSource: AdminBookingsDataSource = env.useMocks
  ? mockSource
  : restSource;
