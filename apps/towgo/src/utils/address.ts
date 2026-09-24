/**
 * Addresses the way ride apps show them (owner, 24 Sep 2026: "see how Rapido
 * shows the address"): a stop is stored as its full address,
 * "11/158, Swami Shajanand Colony, Muzaffarpur, Bihar 842001", and drawn as a
 * bold first part over the rest.
 */

/** "—" is the REST mapper's stand-in for a missing address; it is not text to show. */
const MISSING = '—';

/** A Google plus code ("49J9+HW2"), and a house number that is only digits and separators. */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}$/i;
const HOUSE_NUMBER = /^[\d\s/\\-]+[a-z]?$/i;

function parts(text: string | null | undefined): string[] {
  const trimmed = text?.trim();
  if (!trimmed || trimmed === MISSING) return [];
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The text a picked place is stored as: its full address, with the place's
 * name in front when the address does not already start with it (a named
 * place, "Phoenix Marketcity, Whitefield Main Road, …"). A place with no
 * address keeps its name.
 */
export function fullPlaceText(label: string, address: string | null | undefined): string {
  const name = label.trim();
  const full = address?.trim() ?? '';
  if (!full) return name;
  if (!name || full.toLowerCase().startsWith(name.toLowerCase())) return full;
  return `${name}, ${full}`;
}

/**
 * A stored address as two lines: the first part, bold, and the rest ("" when
 * there is nothing more, as with a stop saved before full addresses were).
 * Null for a missing address.
 */
export function splitAddress(
  text: string | null | undefined,
): { primary: string; secondary: string } | null {
  const [first, ...rest] = parts(text);
  if (!first) return null;
  return { primary: first, secondary: rest.join(', ') };
}

/**
 * The short name of a place, for a tight line ("Motijheel → Brahmapura"): its
 * first part, unless that is only a house number or a plus code, then the next.
 */
export function shortPlace(text: string | null | undefined): string | null {
  const list = parts(text);
  const named = list.find((part) => !HOUSE_NUMBER.test(part) && !PLUS_CODE.test(part));
  return named ?? list[0] ?? null;
}
