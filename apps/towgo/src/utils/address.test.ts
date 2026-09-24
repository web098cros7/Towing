import { fullPlaceText, shortPlace, splitAddress } from './address';

describe('fullPlaceText', () => {
  it('stores the full address, named places keeping their name', () => {
    expect(fullPlaceText('11/158', '11/158, Swami Shajanand Colony, Muzaffarpur')).toBe(
      '11/158, Swami Shajanand Colony, Muzaffarpur',
    );
    expect(fullPlaceText('Phoenix Marketcity', 'Whitefield Main Road, Bengaluru')).toBe(
      'Phoenix Marketcity, Whitefield Main Road, Bengaluru',
    );
    expect(fullPlaceText('Indiranagar', '')).toBe('Indiranagar');
  });
});

describe('splitAddress', () => {
  it('is the bold first part over the rest', () => {
    expect(splitAddress('11/158, Swami Shajanand Colony, Muzaffarpur, Bihar 842001')).toEqual({
      primary: '11/158',
      secondary: 'Swami Shajanand Colony, Muzaffarpur, Bihar 842001',
    });
  });

  it('has no second line for an old short label, and nothing for a missing one', () => {
    expect(splitAddress('Motijheel Road')).toEqual({ primary: 'Motijheel Road', secondary: '' });
    expect(splitAddress('—')).toBeNull();
    expect(splitAddress('  ')).toBeNull();
  });
});

describe('shortPlace', () => {
  it('skips a house number or plus code for the place name', () => {
    expect(shortPlace('50, Mehdi Hassan Rd, Brahmapura, Muzaffarpur')).toBe('Mehdi Hassan Rd');
    expect(shortPlace('11/158, Swami Shajanand Colony, Muzaffarpur')).toBe(
      'Swami Shajanand Colony',
    );
    expect(shortPlace('49J9+HW2, Brahmapura, Muzaffarpur')).toBe('Brahmapura');
    expect(shortPlace('Indiranagar, Bengaluru')).toBe('Indiranagar');
    expect(shortPlace(null)).toBeNull();
  });
});
