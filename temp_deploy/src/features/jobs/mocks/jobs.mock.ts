import type { Job, JobStatus } from '../types';

const HOUR = 3_600_000;

type Seed = [
  code: string,
  service: string,
  status: JobStatus,
  driver: string | null,
  plate: string | null,
  pickup: string,
  drop: string | null,
  km: number,
  grossPaise: number,
  band: 'A' | 'B' | 'C',
  hoursAgo: number,
];

const seeds: Seed[] = [
  ['TW-88121', 'Flatbed tow', 'en_route', 'Suresh Kumar', 'KA-01-AB-1234', 'Indiranagar', 'Whitefield', 14.2, 449_900, 'A', 0.4],
  ['TW-88119', 'Wheel-lift tow', 'in_progress', 'Manoj Pillai', 'KA-05-MJ-7788', 'Koramangala', 'HSR Layout', 6.8, 149_900, 'A', 1.1],
  ['TW-88117', 'Battery jumpstart', 'assigned', 'Ravi Shetty', 'KA-02-ZX-3344', 'MG Road', null, 2.1, 79_900, 'A', 0.2],
  ['TW-88110', 'Highway recovery', 'completed', 'Abdul Rasheed', 'KA-51-GH-9902', 'Electronic City', 'Hosur Rd workshop', 48.5, 599_880, 'B', 5.5],
  ['TW-88102', 'Flatbed tow', 'paid', 'Dinesh Gowda', 'KA-41-RT-2210', 'Jayanagar', 'Bannerghatta Rd', 11.3, 449_900, 'A', 9],
  ['TW-88096', 'Wheel-lift tow', 'paid', 'Imran Sait', 'KA-09-WE-8899', 'Yeshwanthpur', 'Peenya', 8.9, 149_900, 'A', 22],
  ['TW-88090', 'Long-distance haul', 'paid', 'Abdul Rasheed', 'KA-51-GH-9902', 'Bengaluru', 'Chennai', 312, 4_000_000, 'C', 30],
  ['TW-88085', 'Flat-tyre assist', 'cancelled', null, null, 'Hebbal', null, 4.4, 0, 'A', 33],
  ['TW-88079', 'Accident recovery', 'paid', 'Suresh Kumar', 'KA-01-AB-1234', 'Tumkur Rd', 'Rajajinagar', 26.7, 549_880, 'B', 47],
  ['TW-88070', 'Wheel-lift tow', 'paid', 'Manoj Pillai', 'KA-05-MJ-7788', 'BTM Layout', 'JP Nagar', 5.2, 149_900, 'A', 51],
  ['TW-88061', 'Fuel delivery', 'paid', 'Ravi Shetty', 'KA-02-ZX-3344', 'Marathahalli', null, 3.3, 69_900, 'A', 70],
  ['TW-88054', 'Flatbed tow', 'paid', 'Dinesh Gowda', 'KA-41-RT-2210', 'Sarjapur Rd', 'Domlur', 16.8, 449_900, 'A', 75],
];

const BAND_PCT: Record<'A' | 'B' | 'C', number> = { A: 10, B: 8, C: 5 };

export const jobsMock: Job[] = seeds.map(
  ([code, serviceType, status, driverName, truckPlate, pickupArea, dropArea, distanceKm, grossPaise, commissionBand, hoursAgo]) => {
    const commissionPct = BAND_PCT[commissionBand];
    const commissionPaise = Math.round((grossPaise * commissionPct) / 100);
    return {
      id: code.toLowerCase(),
      code,
      serviceType,
      status,
      driverName,
      truckPlate,
      pickupArea,
      dropArea,
      distanceKm,
      grossPaise,
      commissionBand,
      commissionPct,
      commissionPaise,
      poolPaise: grossPaise - commissionPaise,
      createdAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
    };
  },
);
