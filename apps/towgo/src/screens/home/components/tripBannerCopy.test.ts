import { bannerCopy } from './tripBannerCopy';

const booking = {
  originLabel: '12, MG Road, Ashok Nagar, Bengaluru',
  destinationLabel: 'Indiranagar, Bengaluru',
};

describe('bannerCopy', () => {
  it('draws the design on the tow leg', () => {
    expect(bannerCopy(booking, undefined, 'in_progress', '10:50 AM')).toEqual({
      title: 'Drop by 10:50 AM',
      subtitle: 'Heading to Indiranagar',
    });
  });

  it('never invents a time before the server sends one', () => {
    expect(bannerCopy(booking, undefined, 'in_progress', null).title).toBe('Towing your vehicle');
    expect(bannerCopy(booking, undefined, 'en_route', null).title).toBe('Driver on the way');
  });

  it('names the pickup before the tow starts', () => {
    expect(bannerCopy(booking, undefined, 'en_route', '10:17 AM').title).toBe(
      'Arriving by 10:17 AM',
    );
    expect(bannerCopy(booking, undefined, 'searching', null).title).toBe('Finding your driver');
    expect(bannerCopy(booking, undefined, 'arrived', null).title).toBe('Your driver is here');
  });

  it('has no drop to head to on a roadside job', () => {
    expect(
      bannerCopy({ ...booking, destinationLabel: '' }, undefined, 'in_progress', null).title,
    ).toBe('Service in progress');
  });
});
