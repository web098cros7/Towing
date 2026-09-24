import { bearingBetween, metresBetween } from './bearing';

describe('bearingBetween', () => {
  it('faces the way the truck moved', () => {
    const at = { lat: 26.12, lng: 85.36 };
    expect(bearingBetween(at, { lat: 26.12, lng: 85.37 })).toBeCloseTo(90, 0); // east
    expect(bearingBetween(at, { lat: 26.12, lng: 85.35 })).toBeCloseTo(270, 0); // west
    expect(bearingBetween(at, { lat: 26.13, lng: 85.36 })).toBeCloseTo(0, 0); // north
    expect(bearingBetween(at, { lat: 26.11, lng: 85.36 })).toBeCloseTo(180, 0); // south
  });
});

describe('metresBetween', () => {
  it('measures about 111 m per thousandth of a degree of latitude', () => {
    expect(metresBetween({ lat: 26.12, lng: 85.36 }, { lat: 26.121, lng: 85.36 })).toBeCloseTo(
      111,
      0,
    );
  });
});
