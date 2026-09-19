import type { PlaceDetail } from '@towing/api-contracts';
import type { PickOnMapPlace, PickOnMapPlaceSource } from './pickOnMapPlace';

/**
 * Live display lines for screen 13, formatted from the contract's own fields.
 *
 * The title is "<area/road>, <city>": the contract `label`, plus the city read
 * out of `address` when the address names one. Both geocoders behind
 * `places/reverse` put the city directly before the state ("…, Bengaluru,
 * Karnataka 560001, India"), or last when no state is written ("5th Block,
 * Bengaluru"). Anything that does not parse keeps the bare label, so a
 * coordinate-only answer stays a coordinate.
 */

/** Indian states and union territories, lower case. */
const REGIONS = new Set([
  'andhra pradesh',
  'arunachal pradesh',
  'assam',
  'bihar',
  'chhattisgarh',
  'goa',
  'gujarat',
  'haryana',
  'himachal pradesh',
  'jharkhand',
  'karnataka',
  'kerala',
  'madhya pradesh',
  'maharashtra',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'odisha',
  'punjab',
  'rajasthan',
  'sikkim',
  'tamil nadu',
  'telangana',
  'tripura',
  'uttar pradesh',
  'uttarakhand',
  'west bengal',
  'andaman and nicobar islands',
  'chandigarh',
  'dadra and nagar haveli and daman and diu',
  'delhi',
  'jammu and kashmir',
  'ladakh',
  'lakshadweep',
  'puducherry',
]);

const COUNTRY = /^india$/i;
/** A six-digit PIN trailing the state: "Karnataka 560001". */
const PIN = /\b\d{6}\b/g;
/** A house number or a bare coordinate part: "12", "12A", "12/3", "77.60680". */
const HOUSE_NUMBER = /^[\d\s./-]+[A-Za-z]?$/;

function addressParts(address: string): string[] {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  if (last !== undefined && COUNTRY.test(last)) parts.pop();
  return parts;
}

function cityOf(parts: string[]): string | undefined {
  let regionAt = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const name = (parts[i] ?? '').replace(PIN, ' ').trim().toLowerCase();
    if (REGIONS.has(name)) {
      regionAt = i;
      break;
    }
  }
  const city = regionAt >= 0 ? parts[regionAt - 1] : parts[parts.length - 1];
  if (city === undefined || HOUSE_NUMBER.test(city)) return undefined;
  return city;
}

function titleOf(place: PlaceDetail, parts: string[]): string {
  const label = place.label.trim();
  // Google labels a street address by its first component, the house number.
  const road = HOUSE_NUMBER.test(label)
    ? (parts.find((part) => !HOUSE_NUMBER.test(part)) ?? label)
    : label;
  const city = cityOf(parts);
  if (city === undefined || road.toLowerCase().includes(city.toLowerCase())) return road;
  return `${road}, ${city}`;
}

export const pickOnMapPlaceLiveSource: PickOnMapPlaceSource = {
  withDisplay(place): PickOnMapPlace {
    const parts = addressParts(place.address);
    return {
      ...place,
      displayTitle: titleOf(place, parts),
      displayAddress: parts.length > 0 ? parts.join(', ') : place.address,
    };
  },
};
