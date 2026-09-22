import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, type TextInput } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { PlaceDetail } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { haptics } from '@/motion';
import type { LatLng } from '@/types/geo';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { useLocationStore } from '@/features/location/locationStore';
import { placesKeys } from '@/features/places/api/places.keys';
import { resolvePlace, usePlaceAutocomplete } from '@/features/places/api/places.queries';
import { placesDataSource } from '@/features/places/api/placesDataSource';
import { recentLocations } from '../../data/recentLocations.data';
import type { LocationField } from '../LocationFields';
import { useRecentPlacesStore } from './recentPlacesStore';

type Drafts = Record<LocationField, string | null>;

const samePoint = (a: LatLng | null | undefined, b: LatLng | null | undefined) =>
  !!a && !!b && a.latitude === b.latitude && a.longitude === b.longitude;

/**
 * The value a resolved place writes into Pickup / Drop. Figma 10 draws it as
 * "<place>, <city>" ("MG Road, Bengaluru"). The contract's `label` is the bare
 * short name, so mock mode maps it through the mock rows' `value` (the same
 * display titles screen 13 shows); live mode writes `label`.
 */
function placeFieldValue(place: PlaceDetail): string {
  if (!env.useMocks) return place.label;
  return recentLocations.find((l) => l.name === place.label)?.value ?? place.label;
}

/** The honest label when a point cannot be geocoded (the same fallback screen 13 uses). */
const coordinateValue = (p: LatLng) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

/**
 * Editing Figma 10's Pickup and Drop values.
 *
 * ⚠ NO SEARCH UI IS DRAWN. The board says "Search pickup and drop, or use
 * recents", but no frame draws a suggestions list, so nothing is shown while
 * the customer types: Saved & Recent stays exactly as drawn. Typed text is a
 * local draft; when editing ends (keyboard Done / Next, focus leaving the
 * field, or Continue) the draft resolves to the best-matching place and its
 * coordinate. If nothing matches, the field returns to the place it held, with
 * an error haptic, because the design has no error copy.
 *
 * THE COORDINATE MOVES WITH THE LABEL, ALWAYS: the booking store only ever
 * receives a label together with its coordinate, so the fare engine never
 * prices the previous place under a new name.
 */
export function useLocationEditing({
  pickupRef,
  dropRef,
}: {
  pickupRef: RefObject<TextInput | null>;
  dropRef: RefObject<TextInput | null>;
}) {
  const queryClient = useQueryClient();

  const pickupAddress = useBookingStore((s) => s.pickupAddress);
  const dropAddress = useBookingStore((s) => s.dropAddress);
  const setPickupAddress = useBookingStore((s) => s.setPickupAddress);
  const setDropAddress = useBookingStore((s) => s.setDropAddress);
  const setPickupCoords = useBookingStore((s) => s.setPickupCoords);
  const setDropCoords = useBookingStore((s) => s.setDropCoords);
  const swapAddresses = useBookingStore((s) => s.swapAddresses);

  const devicePoint = useLocationStore((s) => s.pickup.coords);
  const requestCurrentLocation = useLocationStore((s) => s.resolveCurrentLocation);
  const addRecent = useRecentPlacesStore((s) => s.addRecent);

  const [drafts, setDrafts] = useState<Drafts>({ pickup: null, drop: null });
  const draftsRef = useRef<Drafts>(drafts);
  const pending = useRef<Partial<Record<LocationField, Promise<void>>>>({});
  const [focusedField, setFocusedField] = useState<LocationField | null>(null);
  /** The field a saved / recent row fills. Starts on drop when a pickup is already known. */
  const [activeField, setActiveField] = useState<LocationField>(pickupAddress ? 'drop' : 'pickup');
  const [locating, setLocating] = useState(false);

  const setDraft = useCallback((field: LocationField, value: string | null) => {
    draftsRef.current = { ...draftsRef.current, [field]: value };
    setDrafts(draftsRef.current);
  }, []);

  // Warms the (debounced, cached) search for text the customer has actually
  // typed, so ending the edit usually resolves from cache. Focusing a field
  // without changing it searches nothing. Nothing is drawn from it.
  const focusedDraft = focusedField ? drafts[focusedField] : null;
  const focusedStored = focusedField === 'pickup' ? pickupAddress : dropAddress;
  usePlaceAutocomplete(
    focusedDraft !== null && focusedDraft.trim() !== focusedStored.trim() ? focusedDraft : '',
    devicePoint,
  );

  /** Writes a place into a field. Clears that field's draft first, so a following blur has nothing to resolve. */
  const apply = useCallback(
    (field: LocationField, label: string, point: LatLng) => {
      setDraft(field, null);
      if (field === 'pickup') {
        setPickupAddress(label);
        setPickupCoords(point);
        setActiveField('drop');
      } else {
        setDropAddress(label);
        setDropCoords(point);
      }
    },
    [setDraft, setPickupAddress, setPickupCoords, setDropAddress, setDropCoords],
  );

  /** Resolves a field's draft to a place (see above). Safe to call repeatedly. */
  const commit = useCallback(
    (field: LocationField): Promise<void> => {
      const inFlight = pending.current[field];
      if (inFlight) return inFlight;
      const draft = draftsRef.current[field];
      if (draft === null) return Promise.resolve();

      const text = draft.trim();
      const state = useBookingStore.getState();
      const current = field === 'pickup' ? state.pickupAddress : state.dropAddress;
      if (!text || text === current.trim()) {
        setDraft(field, null);
        return Promise.resolve();
      }

      const near = useLocationStore.getState().pickup.coords;
      const run = (async () => {
        try {
          const { predictions } = await queryClient.fetchQuery({
            queryKey: placesKeys.autocomplete(text, near),
            queryFn: () => placesDataSource.autocomplete(text, near),
            staleTime: 5 * 60_000,
          });
          const top = predictions[0];
          if (!top) throw new Error('No place matches');
          const place = await resolvePlace(top.placeId);
          // The customer typed on, or picked something else, meanwhile.
          if (draftsRef.current[field] !== draft) return;
          const point = { latitude: place.point.lat, longitude: place.point.lng };
          const value = placeFieldValue(place);
          apply(field, value, point);
          addRecent({
            id: top.placeId,
            name: top.primary,
            address: top.secondary || place.address,
            coords: point,
            value,
          });
        } catch {
          if (draftsRef.current[field] === draft) {
            setDraft(field, null);
            haptics.error();
          }
        } finally {
          delete pending.current[field];
        }
      })();
      pending.current[field] = run;
      return run;
    },
    [queryClient, apply, addRecent, setDraft],
  );

  const onFocusField = useCallback(
    (field: LocationField) => {
      setActiveField(field);
      setFocusedField(field);
      if (draftsRef.current[field] === null) {
        const state = useBookingStore.getState();
        setDraft(field, field === 'pickup' ? state.pickupAddress : state.dropAddress);
      }
    },
    [setDraft],
  );

  const onBlurField = useCallback(
    (field: LocationField) => {
      setFocusedField((f) => (f === field ? null : f));
      void commit(field);
    },
    [commit],
  );

  /** Saved or recent row: fills the active field. */
  const selectPlace = useCallback(
    (label: string, point: LatLng) => {
      apply(activeField, label, point);
      Keyboard.dismiss();
    },
    [activeField, apply],
  );

  /** The device fix, or null when permission or GPS is unavailable. */
  const deviceFix = useCallback(async (): Promise<LatLng | null> => {
    await requestCurrentLocation();
    const { status, pickup } = useLocationStore.getState();
    return status === 'ready' && pickup.coords ? pickup.coords : null;
  }, [requestCurrentLocation]);

  const labelFor = useCallback(async (point: LatLng) => {
    try {
      return placeFieldValue(await placesDataSource.reverse(point));
    } catch {
      return coordinateValue(point);
    }
  }, []);

  /** Locate: pickup = the device's location, as a place label. */
  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const point = await deviceFix();
      if (!point) {
        haptics.error();
        return;
      }
      apply('pickup', await labelFor(point), point);
      Keyboard.dismiss();
    } finally {
      setLocating(false);
    }
  }, [deviceFix, labelFor, apply]);

  /**
   * Swap. With no drop yet there is nothing to move into Pickup, which must
   * stay filled, so it does nothing (the press still gives its haptic).
   */
  const swap = useCallback(() => {
    const state = useBookingStore.getState();
    if (!state.dropAddress.trim() || !state.dropCoords) return;
    setDraft('pickup', null);
    setDraft('drop', null);
    Keyboard.dismiss();
    swapAddresses();
    // An empty pickup moved into Drop must not leave a coordinate behind.
    if (!state.pickupAddress.trim()) setDropCoords(null);
  }, [setDraft, swapAddresses, setDropCoords]);

  const discardDrafts = useCallback(() => {
    setDraft('pickup', null);
    setDraft('drop', null);
  }, [setDraft]);

  /**
   * Resolves any typed text, then reports what is still missing (focusing that
   * field) or `true` when both places are set.
   */
  const finish = useCallback(async (): Promise<boolean> => {
    await Promise.all([commit('pickup'), commit('drop')]);
    const state = useBookingStore.getState();
    if (!state.pickupAddress.trim()) {
      pickupRef.current?.focus();
      return false;
    }
    if (!state.dropAddress.trim() || !state.dropCoords) {
      dropRef.current?.focus();
      return false;
    }
    Keyboard.dismiss();
    return true;
  }, [commit, pickupRef, dropRef]);

  /**
   * Real backend only: the booking store starts from the location store's
   * built-in default place ("MG Road, Bengaluru"), which is not where this
   * customer is. While Pickup still holds that untouched default, replace it
   * with the device's location; if there is no fix, clear it rather than book a
   * tow to a place the customer never chose. Mock mode keeps the default, which
   * is the drawn example.
   */
  useEffect(() => {
    if (env.useMocks) return;
    const seed = useBookingStore.getInitialState();
    const isSeed = () => {
      const s = useBookingStore.getState();
      return (
        s.pickupAddress === seed.pickupAddress &&
        samePoint(s.pickupCoords, seed.pickupCoords) &&
        draftsRef.current.pickup === null
      );
    };
    if (!isSeed()) return;

    let cancelled = false;
    void (async () => {
      const point = await deviceFix();
      if (cancelled || !isSeed()) return;
      if (!point) {
        setPickupAddress('');
        setActiveField('pickup');
        return;
      }
      const label = await labelFor(point);
      if (cancelled || !isSeed()) return;
      apply('pickup', label, point);
    })();
    return () => {
      cancelled = true;
    };
    // Once per visit to the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    pickupText: drafts.pickup ?? pickupAddress,
    dropText: drafts.drop ?? dropAddress,
    activeField,
    locating,
    onChangeText: setDraft as (field: LocationField, text: string) => void,
    onFocusField,
    onBlurField,
    selectPlace,
    locate,
    swap,
    discardDrafts,
    finish,
  };
}
