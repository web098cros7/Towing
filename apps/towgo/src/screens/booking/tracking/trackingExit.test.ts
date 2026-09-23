import { trackingExitFor } from './trackingExit';

describe('trackingExitFor', () => {
  it.each(['assigned', 'en_route', 'arrived', 'in_progress', undefined])(
    'keeps the trip on screen while %s',
    (status) => {
      expect(trackingExitFor(status, true)).toBeNull();
    },
  );

  it('sends a finished trip to Payment and a settled one to Booking Details', () => {
    expect(trackingExitFor('completed', true)).toEqual({ to: 'Payment' });
    expect(trackingExitFor('paid', true)).toEqual({ to: 'BookingDetails' });
  });

  it('T15: a disputed or refunded trip goes to Booking Details, not the old sheet', () => {
    expect(trackingExitFor('disputed', true)).toEqual({ to: 'BookingDetails' });
    expect(trackingExitFor('refunded', true)).toEqual({ to: 'BookingDetails' });
  });

  it('T15: a driver dropping out goes back to searching and says why', () => {
    expect(trackingExitFor('searching', true)).toEqual({
      to: 'Searching',
      tellDriverDroppedOut: true,
    });
    expect(trackingExitFor('no_drivers_found', true)).toEqual({
      to: 'Searching',
      tellDriverDroppedOut: true,
    });
  });

  it('T15: a trip that never had a driver goes to searching without the dropout message', () => {
    expect(trackingExitFor('searching', false)).toEqual({
      to: 'Searching',
      tellDriverDroppedOut: false,
    });
  });

  it('sends a cancelled trip Home', () => {
    expect(trackingExitFor('cancelled', true)).toEqual({ to: 'Home' });
  });
});
