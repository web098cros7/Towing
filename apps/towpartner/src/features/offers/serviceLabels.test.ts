import type { ServiceType } from '@towing/api-contracts';
import { SERVICE_ICON, SERVICE_LABEL, isAtTheSpot, serviceLabel } from './serviceLabels';

/**
 * The words a driver reads for the job they are being offered.
 *
 * Worth testing rather than trusting to review: the driver app and the customer
 * app must name the same service the same way — a customer who booked "Car
 * Lockout" and a driver told "Tow" are looking at one job through two
 * vocabularies — and the truck class is appended for exactly two services,
 * which is the kind of rule that quietly grows a third.
 */

const ALL_SERVICES: ServiceType[] = [
  'tow',
  'battery',
  'flat_tyre',
  'fuel',
  'lockout',
  'breakdown',
  'accident_recovery',
];

describe('serviceLabels', () => {
  it('names every service the contract defines', () => {
    for (const service of ALL_SERVICES) {
      expect(SERVICE_LABEL[service]).toBeTruthy();
      expect(SERVICE_ICON[service]).toBeTruthy();
    }
  });

  it('appends the truck class to a tow and to an accident recovery', () => {
    expect(serviceLabel({ serviceType: 'tow', vehicleClass: 'flatbed' })).toBe(
      'Tow a Car · Flatbed',
    );
    expect(serviceLabel({ serviceType: 'tow', vehicleClass: 'wheel_lift' })).toBe(
      'Tow a Car · Wheel-lift',
    );
    expect(
      serviceLabel({ serviceType: 'accident_recovery', vehicleClass: 'flatbed' }),
    ).toBe('Accident Recovery · Flatbed');
  });

  it('leaves the truck class off every at-the-spot service', () => {
    const roadside: ServiceType[] = ['battery', 'flat_tyre', 'fuel', 'lockout', 'breakdown'];
    for (const service of roadside) {
      expect(serviceLabel({ serviceType: service, vehicleClass: 'flatbed' })).toBe(
        SERVICE_LABEL[service],
      );
    }
  });

  it('treats a job with no drop as at-the-spot', () => {
    expect(isAtTheSpot({ drop: null })).toBe(true);
    expect(isAtTheSpot({ drop: { lat: 12.9, lng: 77.6 } })).toBe(false);
  });
});
