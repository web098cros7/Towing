import type { ComplianceDoc, ComplianceDocType, Truck } from '../types';

const DAY = 86_400_000;

function doc(
  docType: ComplianceDocType,
  daysToExpiry: number | null,
  id: string,
): ComplianceDoc {
  if (daysToExpiry === null) {
    return { id, docType, issuedAt: null, expiresAt: null, status: 'missing' };
  }
  const status = daysToExpiry < 0 ? 'expired' : daysToExpiry <= 30 ? 'expiring' : 'valid';
  return {
    id,
    docType,
    issuedAt: new Date(Date.now() - 300 * DAY).toISOString(),
    expiresAt: new Date(Date.now() + daysToExpiry * DAY).toISOString(),
    status,
  };
}

/** Bengaluru (§2 persona city) — the mock fleet's home. */
const MOCK_ORIGIN = { lat: 12.9716, lng: 77.5946 };

const baseTrucks: Array<Omit<Truck, 'currentLocation' | 'lastPingAt'>> = [
  {
    id: 'tr-1',
    plate: 'KA-01-AB-1234',
    type: 'flatbed',
    capacityTons: 5,
    status: 'non_compliant',
    assignedDriverName: 'Suresh Kumar',
    compliance: [
      doc('insurance', -4, 'cd-1a'),
      doc('rc', 220, 'cd-1b'),
      doc('puc', 90, 'cd-1c'),
      doc('permit', 140, 'cd-1d'),
    ],
  },
  {
    id: 'tr-2',
    plate: 'KA-05-MJ-7788',
    type: 'wheel_lift',
    capacityTons: 2.5,
    status: 'active',
    assignedDriverName: 'Manoj Pillai',
    compliance: [
      doc('insurance', 200, 'cd-2a'),
      doc('rc', 400, 'cd-2b'),
      doc('puc', 12, 'cd-2c'),
      doc('permit', 60, 'cd-2d'),
    ],
  },
  {
    id: 'tr-3',
    plate: 'KA-03-QT-5511',
    type: 'wheel_lift',
    capacityTons: 2.5,
    status: 'active',
    assignedDriverName: null,
    compliance: [
      doc('insurance', 110, 'cd-3a'),
      doc('rc', 500, 'cd-3b'),
      doc('puc', 75, 'cd-3c'),
      doc('permit', 30, 'cd-3d'),
    ],
  },
  {
    id: 'tr-4',
    plate: 'KA-51-GH-9902',
    type: 'flatbed',
    capacityTons: 7,
    status: 'active',
    assignedDriverName: 'Abdul Rasheed',
    compliance: [
      doc('insurance', 320, 'cd-4a'),
      doc('rc', 800, 'cd-4b'),
      doc('puc', 150, 'cd-4c'),
      doc('permit', 210, 'cd-4d'),
    ],
  },
  {
    id: 'tr-5',
    plate: 'KA-02-ZX-3344',
    type: 'flatbed',
    capacityTons: 5,
    status: 'active',
    assignedDriverName: 'Ravi Shetty',
    compliance: [
      doc('insurance', 45, 'cd-5a'),
      doc('rc', 600, 'cd-5b'),
      doc('puc', 28, 'cd-5c'),
      doc('permit', 90, 'cd-5d'),
    ],
  },
  {
    id: 'tr-6',
    plate: 'KA-04-PL-6677',
    type: 'wheel_lift',
    capacityTons: 2.5,
    status: 'inactive',
    assignedDriverName: null,
    compliance: [
      doc('insurance', 180, 'cd-6a'),
      doc('rc', 350, 'cd-6b'),
      doc('puc', null, 'cd-6c'),
      doc('permit', 120, 'cd-6d'),
    ],
  },
  {
    id: 'tr-7',
    plate: 'KA-09-WE-8899',
    type: 'wheel_lift',
    capacityTons: 3,
    status: 'active',
    assignedDriverName: 'Imran Sait',
    compliance: [
      doc('insurance', 260, 'cd-7a'),
      doc('rc', 700, 'cd-7b'),
      doc('puc', 200, 'cd-7c'),
      doc('permit', 300, 'cd-7d'),
    ],
  },
  {
    id: 'tr-8',
    plate: 'KA-41-RT-2210',
    type: 'flatbed',
    capacityTons: 8,
    status: 'active',
    assignedDriverName: 'Dinesh Gowda',
    compliance: [
      doc('insurance', 150, 'cd-8a'),
      doc('rc', 450, 'cd-8b'),
      doc('puc', 95, 'cd-8c'),
      doc('permit', 25, 'cd-8d'),
    ],
  },
];

/**
 * Positions are derived rather than hand-written: deterministic (so demos and
 * Playwright runs look identical every time) and spread around the city so the
 * mock live map is legible. `inactive` trucks carry a stale ping on purpose —
 * it is what makes the §11.6 ghost state visible without unplugging anything.
 */
export const trucksMock: Truck[] = baseTrucks.map((truck, index) => {
  const angle = (index / baseTrucks.length) * Math.PI * 2;
  const radius = 0.02 + (index % 3) * 0.012;
  return {
    ...truck,
    currentLocation: {
      lat: MOCK_ORIGIN.lat + radius * Math.sin(angle),
      lng: MOCK_ORIGIN.lng + radius * Math.cos(angle),
    },
    lastPingAt: new Date(Date.now() - (truck.status === 'inactive' ? 90_000 : 2_000)).toISOString(),
  };
});
