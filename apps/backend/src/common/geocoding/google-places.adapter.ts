import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { GeoPoint, PlaceSource } from '@towing/api-contracts';
import { ENV, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../http/external-call.policy';
import type { GeocodingPort, PlaceDetailResult, PlacePredictionResult } from './geocoding.port';

/**
 * Google Places + Geocoding, through §19.3's `ExternalCallPolicy`.
 *
 * NEVER EXECUTED AGAINST GOOGLE. No Maps key exists (SETUP-CHECKLIST item 7),
 * so this is written against the documented request/response shapes and
 * exercised only by fakes — the same honest standing as
 * `GoogleDistanceMatrixAdapter` and Phase 13's four channel adapters.
 * `GEOCODING_PROVIDER` defaults to `local` and production refuses to boot on
 * this adapter with no key.
 *
 * THE SESSION TOKEN IS THE PART THAT WILL SURPRISE SOMEONE LATER. Google bills
 * autocomplete per KEYSTROKE unless the requests are grouped into a session
 * that ends with a Details call, in which case the whole session is billed once
 * at the Details rate. That is roughly an order of magnitude, and it is why
 * `autocomplete` accepts a session token from the caller rather than minting one
 * per request — the token has to survive across the several requests one typed
 * address produces, so only the client can own it. Until a key exists nothing
 * threads one through, which is a deliberate incompleteness recorded here rather
 * than a forgotten field.
 *
 * THE TIMEOUT IS TIGHT FOR A DIFFERENT REASON THAN ROUTING'S. Distance Matrix
 * is tight because it sits inside §7.6's 2-second fare guarantee. This one is
 * tight because a human is typing: a suggestion list that arrives after the next
 * keystroke has already been sent is worse than no list at all, so a slow answer
 * is not worth waiting for even when it would eventually be correct.
 */

/** A vendor answer that will be exactly as wrong next time. Not worth a retry. */
export class PlacesPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesPermanentError';
  }
}

interface AutocompleteResponse {
  status?: string;
  error_message?: string;
  predictions?: Array<{
    place_id?: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
    description?: string;
  }>;
}

interface DetailsResponse {
  status?: string;
  error_message?: string;
  result?: {
    place_id?: string;
    name?: string;
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  };
}

interface ReverseResponse {
  status?: string;
  error_message?: string;
  results?: Array<{
    place_id?: string;
    formatted_address?: string;
    types?: string[];
  }>;
}

/**
 * Statuses that mean "the request itself is wrong". Retrying these burns the
 * budget while a human waits. `OVER_QUERY_LIMIT` and `UNKNOWN_ERROR` are
 * deliberately absent — those are blips worth a second attempt.
 */
const PERMANENT_STATUSES = new Set(['REQUEST_DENIED', 'INVALID_REQUEST', 'NOT_FOUND']);

/** Google's way of saying "nothing matched", which is a valid answer, not a failure. */
const EMPTY_STATUSES = new Set(['ZERO_RESULTS']);

@Injectable()
export class GooglePlacesAdapter implements GeocodingPort, OnModuleInit {
  readonly source: PlaceSource = 'google_places';
  readonly vendor = 'google_places';

  private readonly logger = new Logger(GooglePlacesAdapter.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly policy: ExternalCallPolicy,
  ) {}

  onModuleInit(): void {
    // Guarded on the provider switch: BOTH adapters are instantiated whichever
    // one the factory picks, so an unguarded check would warn on every boot of a
    // local-gazetteer deployment. `assertProductionSafety` already refuses this
    // combination in production; in dev it is a warning.
    if (this.env.GEOCODING_PROVIDER !== 'google_places') return;
    if (!this.env.GOOGLE_MAPS_API_KEY) {
      this.logger.warn(
        'GEOCODING_PROVIDER=google_places but GOOGLE_MAPS_API_KEY is unset — every call will fall back to the local gazetteer',
      );
    }
  }

  async autocomplete(query: string, near?: GeoPoint): Promise<PlacePredictionResult[]> {
    const url = new URL(`${this.env.GOOGLE_PLACES_URL}/autocomplete/json`);
    url.searchParams.set('input', query);
    url.searchParams.set('key', this.apiKey());
    // §2's persona city. Restricting to India is a product fact, not an
    // optimisation: a tow cannot be dispatched to Ohio, and unrestricted results
    // put unreachable places at the top of the list for short queries.
    url.searchParams.set('components', 'country:in');
    if (near) {
      url.searchParams.set('location', `${near.lat},${near.lng}`);
      url.searchParams.set('radius', '50000');
    }

    const body = await this.get<AutocompleteResponse>(url, 'autocomplete');
    if (body === null) return [];

    return (body.predictions ?? []).flatMap((prediction) => {
      const placeId = prediction.place_id;
      if (!placeId) return [];
      const primary = prediction.structured_formatting?.main_text ?? prediction.description ?? '';
      if (primary === '') return [];
      return [
        {
          placeId,
          primary,
          secondary: prediction.structured_formatting?.secondary_text ?? '',
        },
      ];
    });
  }

  async details(placeId: string): Promise<PlaceDetailResult | null> {
    const url = new URL(`${this.env.GOOGLE_PLACES_URL}/details/json`);
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('key', this.apiKey());
    // Only the fields we use. Places bills by field group, so requesting the
    // default set costs several times this one for data nothing reads.
    url.searchParams.set('fields', 'place_id,name,formatted_address,geometry');

    const body = await this.get<DetailsResponse>(url, 'details');
    const result = body?.result;
    const lat = result?.geometry?.location?.lat;
    const lng = result?.geometry?.location?.lng;
    if (!result || typeof lat !== 'number' || typeof lng !== 'number') return null;

    const address = cleanFormattedAddress(result.formatted_address ?? '');
    return {
      placeId: result.place_id ?? placeId,
      label: result.name ?? firstPart(address),
      address,
      point: { lat, lng },
    };
  }

  async reverse(point: GeoPoint): Promise<PlaceDetailResult> {
    const url = new URL(this.env.GOOGLE_GEOCODING_URL);
    url.searchParams.set('latlng', `${point.lat},${point.lng}`);
    url.searchParams.set('key', this.apiKey());

    const body = await this.get<ReverseResponse>(url, 'reverse');
    const first = pickReverseResult(body?.results ?? []);
    const address = first?.formatted_address ? cleanFormattedAddress(first.formatted_address) : '';

    // A pin always lands somewhere. With no match the coordinate IS the answer —
    // inventing "Unknown location" would be a label the customer cannot act on,
    // and throwing would break a drag gesture over open country.
    if (!first || !address) {
      return {
        placeId: `latlng:${point.lat},${point.lng}`,
        label: formatCoordinate(point),
        address: formatCoordinate(point),
        point,
      };
    }

    return {
      placeId: first.place_id ?? `latlng:${point.lat},${point.lng}`,
      label: firstPart(address),
      address,
      point,
    };
  }

  private apiKey(): string {
    const key = this.env.GOOGLE_MAPS_API_KEY;
    // Thrown, not defaulted to '': an empty key produces a REQUEST_DENIED that
    // looks like a vendor outage, and the router would then degrade for a
    // configuration mistake instead of reporting one.
    if (!key) throw new PlacesPermanentError('GOOGLE_MAPS_API_KEY is not configured');
    return key;
  }

  /** `null` means "the vendor answered, and the answer is no results". */
  private async get<T extends { status?: string; error_message?: string }>(
    url: URL,
    op: string,
  ): Promise<T | null> {
    const body = await this.policy.run<T>(
      {
        vendor: `${this.vendor}_${op}`,
        timeoutMs: this.env.GEOCODING_TIMEOUT_MS,
        // Two, not three: a human is waiting, and a third attempt would arrive
        // long after they typed the next character.
        attempts: 2,
        isRetryable: (error) => !(error instanceof PlacesPermanentError),
      },
      async (signal) => {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          const message = `${op} returned HTTP ${res.status}`;
          // 4xx other than 429 will be exactly as wrong next time.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new PlacesPermanentError(message);
          }
          throw new Error(message);
        }
        return (await res.json()) as T;
      },
    );

    const status = body.status ?? 'OK';
    if (EMPTY_STATUSES.has(status)) return null;
    if (status !== 'OK') {
      const message = `${op} returned ${status}${body.error_message ? `: ${body.error_message}` : ''}`;
      if (PERMANENT_STATUSES.has(status)) throw new PlacesPermanentError(message);
      throw new Error(message);
    }

    return body;
  }
}

/** Five decimals ≈ 1.1 m — precise enough to act on, short enough to read. */
function formatCoordinate(point: GeoPoint): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

/**
 * The reverse result to show, as ride apps pick it (owner, 24 Sep 2026: "see how
 * Rapido shows the address"): Google often lists a bare plus-code result, or a
 * house-number-less one, first. A street address or a named place wins; then
 * anything that is not only a plus code; then whatever came first.
 */
const PREFERRED_TYPES = new Set([
  'street_address',
  'premise',
  'subpremise',
  'establishment',
  'point_of_interest',
  'route',
]);

export function pickReverseResult<T extends { formatted_address?: string; types?: string[] }>(
  results: T[],
): T | undefined {
  const usable = results.filter(
    (r) => r.formatted_address && cleanFormattedAddress(r.formatted_address),
  );
  return (
    usable.find((r) => (r.types ?? []).some((t) => PREFERRED_TYPES.has(t))) ??
    usable.find((r) => !(r.types ?? []).includes('plus_code')) ??
    results[0]
  );
}

/** A Google plus code ("49C7+FR4", "49C7+9V Muzaffarpur" starts with one). */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}(\s|$)/i;
/** A house number Google fills with zeros ("0", "00"): not an address anyone has. */
const ZERO_NUMBER = /^0+$/;

/**
 * Google's formatted address as a person would write it: plus-code parts and
 * all-zero house numbers dropped, and the trailing ", India" (every address
 * here is in India) removed. "49C7+FR4, Circuit House Rd, Satsang Nagar,
 * Muzaffarpur, Bihar 842001, India" → "Circuit House Rd, Satsang Nagar,
 * Muzaffarpur, Bihar 842001".
 */
export function cleanFormattedAddress(text: string): string {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !PLUS_CODE.test(part) && !ZERO_NUMBER.test(part));
  if (parts.length > 1 && parts[parts.length - 1]!.toLowerCase() === 'india') parts.pop();
  return parts.join(', ');
}

/** The first part of an address: the bold line the app shows. */
function firstPart(address: string): string {
  return address.split(',')[0]?.trim() || address;
}
