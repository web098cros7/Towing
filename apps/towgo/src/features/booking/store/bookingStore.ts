import { create } from 'zustand';
import { useLocationStore } from '@/features/location/locationStore';
import { env } from '@/lib/env';
import type { TowTypeId } from '../types';

export type ScheduleMode = 'now' | 'later';
export type BookingFor = 'me' | 'other';

/** A point the estimate can be run against. */
export type BookingPoint = { latitude: number; longitude: number };

type BookingState = {
  pickupAddress: string;
  dropAddress: string;
  /**
   * Coordinates, added in Phase 14. The store held addresses as free STRINGS
   * only, which is enough to render a summary bar and not enough to price
   * anything: `POST /v1/pricing/estimate` point-in-polygons the pickup against
   * `service_zones` and measures the road distance to the drop.
   *
   * The plan defers coordinates to Phase 15 with Places autocomplete; they are
   * pulled forward here because an estimate cannot be requested without them.
   * `dropCoords` stays null until a destination with a coordinate is chosen,
   * and `useFareEstimate` stays disabled while it is — which is exactly
   * §9.1.5's "no drop needed" state for roadside services and the correct
   * do-nothing state for a tow.
   */
  pickupCoords: BookingPoint;
  dropCoords: BookingPoint | null;
  /** The chosen `services.slug` from `GET /v1/services`. */
  serviceSlug: string;
  /**
   * §9.1.5's "later", as an ISO instant. Null means now.
   *
   * `scheduleMode` alone was never enough to book with — it says THAT the
   * customer wants a later pickup, not WHEN. The pill that sets it had an empty
   * `onPress` until Phase 15, so `'later'` was unreachable anyway.
   */
  scheduledAt: string | null;
  /** §9.1.5's "booking for someone else" — who the driver will actually meet. */
  contact: { name: string; mobile: string } | null;
  towTypeId: TowTypeId;
  scheduleMode: ScheduleMode;
  bookingFor: BookingFor;
  note: string;
  setPickupAddress: (value: string) => void;
  setDropAddress: (value: string) => void;
  setPickupCoords: (point: BookingPoint) => void;
  setDropCoords: (point: BookingPoint | null) => void;
  setServiceSlug: (slug: string) => void;
  setScheduledAt: (iso: string | null) => void;
  setContact: (contact: { name: string; mobile: string } | null) => void;
  swapAddresses: () => void;
  setTowType: (id: TowTypeId) => void;
  setScheduleMode: (mode: ScheduleMode) => void;
  toggleBookingFor: () => void;
  setNote: (value: string) => void;
  /** Re-seed the pickup field from the device/location store. */
  seedFromLocation: () => void;
};

/**
 * `PickupLocation.coords` is optional — the location store can be in a
 * `denied` or `locating` state with a label and no fix. The estimate needs a
 * point regardless, so this is the same MG Road default the location store
 * itself starts from rather than a second invented one.
 */
const FALLBACK_POINT: BookingPoint = { latitude: 12.9752, longitude: 77.605 };

export const useBookingStore = create<BookingState>((set, get) => ({
  // Live: empty until the customer's own location (or a place they pick) fills
  // it. The location store's built-in default ("MG Road, Bengaluru") read as a
  // real pickup (owner, 24 Sep 2026). Mock mode keeps it: it is the drawn example.
  pickupAddress: env.useMocks ? useLocationStore.getState().pickup.label : '',
  dropAddress: '',
  pickupCoords: useLocationStore.getState().pickup.coords ?? FALLBACK_POINT,
  dropCoords: null,
  serviceSlug: 'car_tow',
  scheduledAt: null,
  contact: null,
  towTypeId: 'light',
  scheduleMode: 'now',
  bookingFor: 'me',
  note: '',
  setPickupAddress: (value) => set({ pickupAddress: value }),
  setDropAddress: (value) => set({ dropAddress: value }),
  setPickupCoords: (point) => set({ pickupCoords: point }),
  setDropCoords: (point) => set({ dropCoords: point }),
  setServiceSlug: (slug) => set({ serviceSlug: slug }),
  setScheduledAt: (iso) => set({ scheduledAt: iso, scheduleMode: iso ? 'later' : 'now' }),
  setContact: (contact) => set({ contact, bookingFor: contact ? 'other' : 'me' }),
  // Coordinates swap with their labels — swapping only the strings would quote
  // the old route under the new addresses, which is the worst of both.
  swapAddresses: () =>
    set({
      pickupAddress: get().dropAddress,
      dropAddress: get().pickupAddress,
      pickupCoords: get().dropCoords ?? get().pickupCoords,
      dropCoords: get().pickupCoords,
    }),
  setTowType: (id) => set({ towTypeId: id }),
  setScheduleMode: (mode) => set({ scheduleMode: mode }),
  toggleBookingFor: () => set({ bookingFor: get().bookingFor === 'me' ? 'other' : 'me' }),
  setNote: (value) => set({ note: value }),
  seedFromLocation: () => {
    const { label, coords } = useLocationStore.getState().pickup;
    if (!get().pickupAddress) set({ pickupAddress: label });
    if (!coords) return;
    // Coordinates re-seed unconditionally: the label is a user-editable field
    // they may have typed over, but the coordinate is only ever the device's.
    set({ pickupCoords: coords });
  },
}));
