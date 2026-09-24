import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, type TextInput } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { PlaceDetail, PlacePrediction } from '@towing/api-contracts';
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
import { fullPlaceText } from '@/utils/address';

type Drafts = Record<LocationField, string | null>;

const samePoint = (a: LatLng | null | undefined, b: LatLng | null | undefined) =>
  !!a && !!b && a.latitude === b.latitude && a.longitude === b.longitude;

/**
 * The value a resolved place writes into Pickup / Drop: live, its FULL address
 * (owner, 24 Sep 2026, as Rapido shows it), with the place's name in front for
 * a named place; screens split it into a bold first part and the rest. Mock
 * mode maps the label through the mock rows' `value` ("MG Road, Bengaluru").
 */
function placeFieldValue(place: PlaceDetail): string {
  if (!env.useMocks) return fullPlaceText(place.label, place.address);
  return recentLocations.find((l) => l.name === place.label)?.value ?? place.label;
}

/** The honest label when a point cannot be geocoded (the same fallback screen 13 uses). */
const coordinateValue = (p: LatLng) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

/**
 * Editing Figma 10's Pickup and Drop values.
 *
 * SUGGESTIONS WHILE TYPING (owner decision, 24 Sep 2026; Figma 10 draws no
 * list): the focused field's text is searched and `suggestions` lists the
 * matches, and `selectSuggestion` fills the field with the one tapped. Typed
 * text is a local draft; when editing ends without a pick (keyboard Done /
 * Next, focus leaving the field, or Continue) the draft still resolves to the
 * best-matching place and its coordinate. If nothing matches, the field
 * returns to the place it held, with an error haptic.
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

  // The (debounced, cached) search for text the customer has actually typed.
  // It feeds the suggestions list, and ending the edit usually resolves from
  // cache. Focusing a field without changing it searches nothing.
  const focusedDraft = focusedField ? drafts[focusedField] : null;
  const focusedStored = focusedField === 'pickup' ? pickupAddress : dropAddress;
  const typed =
    focusedDraft !== null && focusedDraft.trim() !== focusedStored.trim() ? focusedDraft : '';
  const autocomplete = usePlaceAutocomplete(typed, devicePoint);
  const suggestions: PlacePrediction[] =
    typed.trim().length >= 2 ? (autocomplete.data?.predictions ?? []) : [];

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

  /**
   * A tapped suggestion fills the field it was searched from. The field shows
   * the place's name at once; the coordinate follows the details lookup. The
   * lookup is registered as the field's pending commit, so the blur that the
   * keyboard closing causes waits for it instead of resolving the typed text.
   */
  const selectSuggestion = useCallback(
    (prediction: PlacePrediction) => {
      const field = focusedField ?? activeField;
      const shown = prediction.primary;
      setDraft(field, shown);
      const run = (async () => {
        try {
          const place = await resolvePlace(prediction.placeId);
          if (draftsRef.current[field] !== shown) return;
          const point = { latitude: place.point.lat, longitude: place.point.lng };
          const value = placeFieldValue(place);
          apply(field, value, point);
          addRecent({
            id: prediction.placeId,
            name: prediction.primary,
            address: prediction.secondary || place.address,
            coords: point,
            value,
          });
        } catch {
          if (draftsRef.current[field] === shown) {
            setDraft(field, null);
            haptics.error();
          }
        } finally {
          delete pending.current[field];
        }
      })();
      pending.current[field] = run;
      Keyboard.dismiss();
    },
    [focusedField, activeField, setDraft, apply, addRecent],
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
   * Real backend only: the booking starts with an empty pickup (never the
   * location store's built-in "MG Road, Bengaluru"). While it is still that
   * untouched seed, fill it with the customer's location: at once from the fix
   * Home already made, else from a fresh one (the field says "Finding your
   * location…" meanwhile). With no fix it stays empty and asks. Mock mode keeps
   * the drawn example.
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

    // Home's fix, if it has one: no second GPS wait, and the street address it
    // already looked up.
    const known = useLocationStore.getState();
    const knownIsReal =
      known.status === 'ready' &&
      !!known.pickup.coords &&
      known.pickup !== useLocationStore.getInitialState().pickup;

    let cancelled = false;
    setLocating(true);
    void (async () => {
      try {
        const point = knownIsReal ? known.pickup.coords! : await deviceFix();
        if (cancelled || !isSeed()) return;
        if (!point) {
          setPickupAddress('');
          setActiveField('pickup');
          return;
        }
        const label =
          knownIsReal && known.pickup.label !== 'Current Location'
            ? known.pickup.label
            : await labelFor(point);
        if (cancelled || !isSeed()) return;
        apply('pickup', label, point);
      } finally {
        if (!cancelled) setLocating(false);
      }
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
    /** The field being typed in, while it has text to search; null otherwise. */
    searchingField: typed.trim().length >= 2 ? focusedField : null,
    suggestions,
    selectSuggestion,
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
