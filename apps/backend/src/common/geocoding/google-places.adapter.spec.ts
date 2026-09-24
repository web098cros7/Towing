import { describe, expect, it } from 'vitest';
import { cleanFormattedAddress, pickReverseResult } from './google-places.adapter';

/**
 * The reverse lookup's address, as Google really answers in Muzaffarpur
 * (captured 24 Sep 2026): plus codes inside addresses, a bare plus-code result,
 * and "00" house numbers. The app showed "49J9+HW2" and "50" as pickups.
 */
describe('cleanFormattedAddress', () => {
  it('drops a plus code, an all-zero house number and ", India"', () => {
    expect(
      cleanFormattedAddress(
        '49C7+FR4, Circuit House Rd, Satsang Nagar, Chakkar South End, Muzaffarpur, Bihar 842001, India',
      ),
    ).toBe('Circuit House Rd, Satsang Nagar, Chakkar South End, Muzaffarpur, Bihar 842001');
    expect(
      cleanFormattedAddress('00, Satsang Nagar, Musahri, Muzaffarpur, Bihar 842001, India'),
    ).toBe('Satsang Nagar, Musahri, Muzaffarpur, Bihar 842001');
  });

  it('keeps a real house number', () => {
    expect(
      cleanFormattedAddress('11/158, Swami Shajanand Colony, Muzaffarpur, Bihar 842001, India'),
    ).toBe('11/158, Swami Shajanand Colony, Muzaffarpur, Bihar 842001');
  });

  it('empties an address that is only a plus code', () => {
    expect(cleanFormattedAddress('49C7+9V Muzaffarpur, Bihar, India')).toBe('Bihar');
    expect(cleanFormattedAddress('49J9+HW2')).toBe('');
  });
});

describe('pickReverseResult', () => {
  it('prefers a street address over a plus-code result listed first', () => {
    const picked = pickReverseResult([
      { formatted_address: '49C7+9V Muzaffarpur, Bihar, India', types: ['plus_code'] },
      {
        formatted_address: '25, Circuit House Rd, Tilak Nagar, Muzaffarpur',
        types: ['street_address'],
      },
    ]);
    expect(picked?.types).toEqual(['street_address']);
  });

  it('falls back to anything that is not only a plus code', () => {
    const picked = pickReverseResult([
      { formatted_address: '49C7+9V Muzaffarpur, Bihar, India', types: ['plus_code'] },
      { formatted_address: 'Muzaffarpur, Bihar, India', types: ['locality'] },
    ]);
    expect(picked?.types).toEqual(['locality']);
  });
});
