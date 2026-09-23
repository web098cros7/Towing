import {
  CORE_SERVICE_TYPES,
  OPTIONAL_SERVICE_TYPES,
  type OptionalServiceType,
} from '@towing/api-contracts';

const OPTIONAL = new Set<string>(OPTIONAL_SERVICE_TYPES);
const CORE = new Set<string>(CORE_SERVICE_TYPES);

/**
 * Narrow a stored `drivers.services` array to the roadside set the contract
 * promises.
 *
 * The column is typed `service_type[]` in Postgres, so it CAN hold `tow` even
 * though nothing writes it there — a hand-run UPDATE, a restored dump from
 * before this split, a future enum value that lands before the code that
 * classifies it. Returning that verbatim would put a value in the response that
 * the client's zod schema rejects, turning a stray row into a broken app
 * screen. Dropping it is right: a `tow` in this column is not a claim about the
 * driver's kit, it is noise from the only place vehicle class is supposed to
 * speak.
 */
export function toOptionalServices(stored: readonly string[] | null): OptionalServiceType[] {
  if (!stored) return [];
  return stored.filter((value): value is OptionalServiceType => OPTIONAL.has(value));
}

/**
 * Does the truck class alone decide this service?
 *
 * True for tow and accident recovery, whose match is `vehicle_class` and always
 * has been. False for the five roadside services, which need the driver's own
 * opt-in — and false for an unknown value, so a service type added to the enum
 * without being classified fails CLOSED. It reaches no driver rather than every
 * driver; an undispatched booking is visible within minutes, a wrongly
 * dispatched one is a driver at a kerb without the kit.
 */
export function isCoreServiceType(serviceType: string): boolean {
  return CORE.has(serviceType);
}
