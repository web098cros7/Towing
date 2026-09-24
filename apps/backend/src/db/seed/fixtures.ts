import type { ServiceType } from '@towing/api-contracts';
import type { DispatchConfigOverride } from '@towing/api-contracts';
import type { LatLng } from '../geography';

/**
 * Static fixture data for `pnpm db:seed`. Everything here is deliberately
 * boring data — all derivation (fares, ledger amounts, timestamps) lives in
 * the seeder so this file reads like a cast list.
 */

/** Console login password for every seeded fleet owner and admin (dev only). */
export const SEED_PASSWORD = 'Password123!';

export interface AdminFixture {
  email: string;
  mobile: string;
  name: string;
  subRole: 'super_admin' | 'operations' | 'support' | 'finance';
}

/**
 * One admin per RBAC sub-role (§4.2, §9.4).
 *
 * All four exist rather than just an owner because the sub-roles differ in what
 * they may DO, and the only way to see that is to have an account that cannot:
 * `support` can hold a completely valid admin session and still be refused by
 * `POST /v1/admin/drivers/:id/kyc`.
 *
 * Without at least one of these, nothing can move a driver to `approved`, and
 * §3.1 makes that a precondition of going online — so every phase downstream of
 * the gate would be untestable on a freshly seeded database.
 */
export const ADMIN_FIXTURES: readonly AdminFixture[] = [
  {
    email: 'super@towing.local',
    mobile: '+919845990001',
    name: 'Ananya Iyer',
    subRole: 'super_admin',
  },
  {
    email: 'ops@towing.local',
    mobile: '+919845990002',
    name: 'Rohit Menon',
    subRole: 'operations',
  },
  {
    email: 'support@towing.local',
    mobile: '+919845990003',
    name: 'Fatima Sheikh',
    subRole: 'support',
  },
  {
    email: 'finance@towing.local',
    mobile: '+919845990004',
    name: 'Deepak Rao',
    subRole: 'finance',
  },
];

export interface FleetFixture {
  key: 'lakshmi' | 'chr';
  businessName: string;
  gstin: string;
  address: string;
  owner: { name: string; mobile: string; email: string };
  /** Roam anchor for trucks/bookings; also decides the zone polygon. */
  areas: ReadonlyArray<readonly [name: string, lat: number, lng: number]>;
  zone: ZoneFixture;
}

export const FLEETS: readonly FleetFixture[] = [
  {
    key: 'lakshmi',
    businessName: 'Lakshmi Recovery Services',
    gstin: '29ABCDE1234F1Z5',
    address: '12, Industrial Layout, Bengaluru 560068',
    owner: { name: 'Lakshmi Narayanan', mobile: '+919845000001', email: 'lakshmi@recovery.in' },
    areas: [
      ['Indiranagar', 12.9716, 77.6412],
      ['Koramangala', 12.9352, 77.6245],
      ['Whitefield', 12.9698, 77.75],
      ['HSR Layout', 12.9121, 77.6446],
      ['MG Road', 12.9756, 77.6068],
      ['Jayanagar', 12.9308, 77.5838],
      ['Yeshwanthpur', 13.0284, 77.5546],
      ['Hebbal', 13.0358, 77.597],
      ['Electronic City', 12.8452, 77.6602],
      ['Marathahalli', 12.9569, 77.7011],
      ['BTM Layout', 12.9166, 77.6101],
      ['Sarjapur Road', 12.901, 77.6874],
    ],
    zone: {
      name: 'Bengaluru Metro',
      wkt: 'SRID=4326;POLYGON((77.45 12.80,77.80 12.80,77.80 13.15,77.45 13.15,77.45 12.80))',
      surgeBand: 'standard',
      // The §6.4 launch ladder, written out rather than left NULL so the seeded
      // database exercises the override path and not only the defaults.
      dispatchConfig: {
        radiusLadderKm: [2, 4, 7, 10, 15],
        offersPerWave: 3,
        offerTimeoutSeconds: 20,
        maxSearchSeconds: 180,
        // A fuel run does not need a 15 km reach; a jerrycan 12 km away is a
        // worse answer than one 5 km away arriving sooner.
        perService: { fuel: { radiusLadderKm: [2, 4, 7] } },
      },
    },
  },
  {
    key: 'chr',
    businessName: 'Chennai Highway Rescue',
    gstin: '33FGHIJ5678K2Z9',
    address: '45 GST Road, Chennai 600045',
    owner: { name: 'Murugan Vel', mobile: '+919845000002', email: 'ops@chennaihighwayrescue.in' },
    areas: [
      ['T Nagar', 13.0418, 80.2341],
      ['Guindy', 13.0067, 80.2206],
      ['Velachery', 12.9815, 80.218],
      ['Tambaram', 12.9249, 80.1],
      ['Thoraipakkam OMR', 12.9403, 80.2339],
      ['Porur', 13.0382, 80.1565],
      ['Anna Nagar', 13.085, 80.2101],
      ['Chromepet GST Road', 12.9516, 80.1462],
    ],
    zone: {
      name: 'Chennai Metro',
      wkt: 'SRID=4326;POLYGON((80.05 12.85,80.32 12.85,80.32 13.15,80.05 13.15,80.05 12.85))',
      // The one surging zone in the seed. Without it `surgePaise` is zero on
      // every seeded estimate and MiTow's surge badge has nothing to render.
      surgeBand: 'high',
      dispatchConfig: { radiusLadderKm: [3, 6, 10, 15], offersPerWave: 3 },
    },
  },
];

/**
 * Compliance profile: [docType, daysToExpiry]. Negative = already expired,
 * `null` = document never uploaded (row omitted). Any expired doc flips the
 * truck to `non_compliant`; ≤30 days becomes `expiring_soon` — the Phase 6
 * worker and the console's expiry badges both feed off these.
 */
/**
 * A geofence row. `isHighway` and `dispatchConfig` were columns nothing wrote
 * until Phase 14 — the former is what makes §7.4's highway surcharge reachable,
 * the latter what §6.7 tunes without a deploy.
 */
export interface ZoneFixture {
  name: string;
  wkt: string;
  surgeBand?: 'standard' | 'high' | 'peak';
  isHighway?: boolean;
  dispatchConfig?: DispatchConfigOverride;
}

/**
 * Zones that belong to no fleet.
 *
 * Zones used to be created only inside the per-fleet loop, so a highway
 * corridor — which is not a fleet's home turf — had nowhere to live, and
 * `is_highway` was false on every row in the database. The §7.4 highway
 * surcharge was therefore unreachable and untestable.
 *
 * NH-44 south of Bengaluru toward Hosur: a long thin strip that deliberately
 * OVERLAPS the Bengaluru Metro polygon at its northern end. That overlap is the
 * point — it is what exercises `ZoneResolverService`'s ordering rule, where a
 * highway zone outranks a city zone for a pickup inside both.
 */
export const STANDALONE_ZONES: readonly ZoneFixture[] = [
  {
    name: 'NH-44 Bengaluru–Hosur Corridor',
    wkt: 'SRID=4326;POLYGON((77.62 12.70,77.72 12.70,77.72 12.95,77.62 12.95,77.62 12.70))',
    isHighway: true,
    surgeBand: 'standard',
    // A highway search starts wider: drivers are sparser and further apart than
    // in a city grid, so a 2 km first wave would return nobody nearly always.
    dispatchConfig: {
      radiusLadderKm: [5, 12, 25, 40],
      bandCRadiusLadderKm: [10, 25, 50],
      offersPerWave: 4,
      maxSearchSeconds: 240,
    },
  },
];

/**
 * Appendix B's nine-entry service catalogue, over the six-value
 * `service_type` enum. Car / bike / flatbed / wheel-lift tow all bill as `tow`
 * and differ only in the class that picks the §7.1 or §7.2 slab — see
 * `common/enums.ts` in contracts for why the enum was not widened to nine.
 */
export interface ServiceFixture {
  slug: string;
  serviceType: ServiceType;
  defaultVehicleClass: 'wheel_lift' | 'flatbed' | null;
  name: string;
  description: string;
  requiresDrop: boolean;
}

export const SERVICE_CATALOG: readonly ServiceFixture[] = [
  {
    slug: 'car_tow',
    serviceType: 'tow',
    // NULL: §9.1.5 step 1 — the customer's own vehicle decides whether a car
    // goes on a wheel-lift or needs a flatbed.
    defaultVehicleClass: null,
    name: 'Car tow',
    description: 'Standard car towing to your chosen destination.',
    requiresDrop: true,
  },
  {
    slug: 'bike_tow',
    serviceType: 'tow',
    defaultVehicleClass: 'wheel_lift',
    name: 'Bike tow',
    description: 'Two-wheeler recovery and transport.',
    requiresDrop: true,
  },
  {
    slug: 'flatbed_tow',
    serviceType: 'tow',
    defaultVehicleClass: 'flatbed',
    name: 'Flatbed tow',
    description: 'Damage-free transport for luxury, SUV and electric vehicles.',
    requiresDrop: true,
  },
  {
    slug: 'wheel_lift_tow',
    serviceType: 'tow',
    defaultVehicleClass: 'wheel_lift',
    name: 'Wheel-lift tow',
    description: 'Quick city recovery for short distances.',
    requiresDrop: true,
  },
  {
    slug: 'battery',
    serviceType: 'battery',
    defaultVehicleClass: null,
    name: 'Battery jumpstart',
    description: 'On-site jumpstart to get you moving again.',
    requiresDrop: false,
  },
  {
    slug: 'flat_tyre',
    serviceType: 'flat_tyre',
    defaultVehicleClass: null,
    name: 'Flat-tyre support',
    description: 'Tyre change or on-the-spot repair.',
    requiresDrop: false,
  },
  {
    slug: 'lockout',
    serviceType: 'lockout',
    defaultVehicleClass: null,
    name: 'Car lockout',
    description: 'Locked out of your car? We get you back in.',
    requiresDrop: false,
  },
  {
    slug: 'fuel',
    serviceType: 'fuel',
    defaultVehicleClass: null,
    name: 'Fuel delivery',
    description: 'Emergency fuel delivered to your location.',
    requiresDrop: false,
  },
  {
    slug: 'breakdown',
    serviceType: 'breakdown',
    defaultVehicleClass: null,
    name: 'Breakdown assistance',
    description: 'General on-site diagnosis and help.',
    requiresDrop: false,
  },
  {
    slug: 'accident_recovery',
    serviceType: 'accident_recovery',
    defaultVehicleClass: 'flatbed',
    name: 'Accident recovery',
    description: 'Post-accident recovery with specialist equipment.',
    requiresDrop: true,
  },
  {
    // Seeded WITHOUT a fare (`DEFAULT_PRICING_RULES.roadside` has none), so a
    // fresh database shows exactly what production does before an admin
    // prices it: the row exists and the customer catalogue does not list it.
    slug: 'winch_out',
    serviceType: 'winch_out',
    defaultVehicleClass: null,
    name: 'Winch out',
    description: 'Stuck in a ditch, mud or sand? We pull you out.',
    requiresDrop: false,
  },
];

export type CompliancePlan = ReadonlyArray<
  readonly [docType: 'insurance' | 'rc' | 'puc' | 'permit', daysToExpiry: number | null]
>;

export interface TruckFixture {
  plate: string;
  type: 'wheel_lift' | 'flatbed';
  capacity: string;
  make: string;
  model: string;
  active: boolean;
  compliance: CompliancePlan;
}

export const TRUCKS: Record<FleetFixture['key'], readonly TruckFixture[]> = {
  lakshmi: [
    {
      plate: 'KA-01-AB-1234',
      type: 'flatbed',
      capacity: '5t',
      make: 'Tata',
      model: 'LPT 1109',
      active: true,
      compliance: [
        ['insurance', -4],
        ['rc', 220],
        ['puc', 90],
        ['permit', 140],
      ],
    },
    {
      plate: 'KA-05-MJ-7788',
      type: 'wheel_lift',
      capacity: '2.5t',
      make: 'Ashok Leyland',
      model: 'Dost+',
      active: true,
      compliance: [
        ['insurance', 200],
        ['rc', 400],
        ['puc', 12],
        ['permit', 60],
      ],
    },
    {
      plate: 'KA-03-QT-5511',
      type: 'wheel_lift',
      capacity: '2.5t',
      make: 'Tata',
      model: 'Intra V30',
      active: true,
      compliance: [
        ['insurance', 110],
        ['rc', 500],
        ['puc', 75],
        ['permit', 30],
      ],
    },
    {
      plate: 'KA-51-GH-9902',
      type: 'flatbed',
      capacity: '7t',
      make: 'Tata',
      model: 'Ultra 1518',
      active: true,
      compliance: [
        ['insurance', 320],
        ['rc', 800],
        ['puc', 150],
        ['permit', 210],
      ],
    },
    {
      plate: 'KA-02-ZX-3344',
      type: 'flatbed',
      capacity: '5t',
      make: 'Tata',
      model: 'LPT 1109',
      active: true,
      compliance: [
        ['insurance', 45],
        ['rc', 600],
        ['puc', 28],
        ['permit', 90],
      ],
    },
    {
      plate: 'KA-04-PL-6677',
      type: 'wheel_lift',
      capacity: '2.5t',
      make: 'Ashok Leyland',
      model: 'Partner',
      active: false,
      compliance: [
        ['insurance', 180],
        ['rc', 350],
        ['puc', null],
        ['permit', 120],
      ],
    },
    {
      plate: 'KA-09-WE-8899',
      type: 'wheel_lift',
      capacity: '3t',
      make: 'Tata',
      model: 'Intra V30',
      active: true,
      compliance: [
        ['insurance', 260],
        ['rc', 700],
        ['puc', 200],
        ['permit', 300],
      ],
    },
    {
      plate: 'KA-41-RT-2210',
      type: 'flatbed',
      capacity: '8t',
      make: 'Tata',
      model: 'Ultra 1518',
      active: true,
      compliance: [
        ['insurance', 150],
        ['rc', 450],
        ['puc', 95],
        ['permit', 25],
      ],
    },
  ],
  chr: [
    {
      plate: 'TN-01-AA-1001',
      type: 'flatbed',
      capacity: '7t',
      make: 'Tata',
      model: 'LPT 1109',
      active: true,
      compliance: [
        ['insurance', 210],
        ['rc', 500],
        ['puc', 120],
        ['permit', 180],
      ],
    },
    {
      plate: 'TN-02-BB-2002',
      type: 'wheel_lift',
      capacity: '2.5t',
      make: 'Ashok Leyland',
      model: 'Dost+',
      active: true,
      compliance: [
        ['insurance', 90],
        ['rc', 400],
        ['puc', 18],
        ['permit', 200],
      ],
    },
    {
      plate: 'TN-09-CC-3003',
      type: 'flatbed',
      capacity: '5t',
      make: 'Tata',
      model: 'Ultra 1518',
      active: true,
      compliance: [
        ['insurance', -10],
        ['rc', 300],
        ['puc', 60],
        ['permit', 90],
      ],
    },
    {
      plate: 'TN-10-DD-4004',
      type: 'wheel_lift',
      capacity: '3t',
      make: 'Tata',
      model: 'Intra V30',
      active: true,
      compliance: [
        ['insurance', 150],
        ['rc', 600],
        ['puc', 240],
        ['permit', 45],
      ],
    },
    {
      plate: 'TN-11-EE-5005',
      type: 'flatbed',
      capacity: '8t',
      make: 'Tata',
      model: 'LPT 1109',
      active: true,
      compliance: [
        ['insurance', 300],
        ['rc', 700],
        ['puc', 130],
        ['permit', 260],
      ],
    },
    {
      plate: 'TN-04-FF-6006',
      type: 'wheel_lift',
      capacity: '2.5t',
      make: 'Ashok Leyland',
      model: 'Partner',
      active: true,
      compliance: [
        ['insurance', 60],
        ['rc', 350],
        ['puc', 9],
        ['permit', 110],
      ],
    },
    {
      plate: 'TN-05-GG-7007',
      type: 'flatbed',
      capacity: '5t',
      make: 'Tata',
      model: 'Ultra 1518',
      active: true,
      compliance: [
        ['insurance', 190],
        ['rc', 550],
        ['puc', 85],
        ['permit', -2],
      ],
    },
    {
      plate: 'TN-12-HH-8008',
      type: 'wheel_lift',
      capacity: '3t',
      make: 'Tata',
      model: 'Intra V30',
      active: true,
      compliance: [
        ['insurance', 230],
        ['rc', 480],
        ['puc', 170],
        ['permit', 210],
      ],
    },
    {
      plate: 'TN-14-JJ-9009',
      type: 'flatbed',
      capacity: '7t',
      make: 'Tata',
      model: 'LPT 1109',
      active: true,
      compliance: [
        ['insurance', 130],
        ['rc', 420],
        ['puc', 75],
        ['permit', 160],
      ],
    },
    {
      plate: 'TN-18-KK-1010',
      type: 'wheel_lift',
      capacity: '2.5t',
      make: 'Ashok Leyland',
      model: 'Dost+',
      active: false,
      compliance: [
        ['insurance', 100],
        ['rc', 380],
        ['puc', 55],
        ['permit', 140],
      ],
    },
    {
      plate: 'TN-20-LL-1111',
      type: 'flatbed',
      capacity: '5t',
      make: 'Tata',
      model: 'Ultra 1518',
      active: true,
      compliance: [
        ['insurance', 280],
        ['rc', 640],
        ['puc', 110],
        ['permit', 230],
      ],
    },
    {
      plate: 'TN-22-MM-1212',
      type: 'wheel_lift',
      capacity: '3t',
      make: 'Tata',
      model: 'Intra V30',
      active: true,
      compliance: [
        ['insurance', 170],
        ['rc', 520],
        ['puc', 145],
        ['permit', 190],
      ],
    },
  ],
};

export interface DriverDocumentFixture {
  docType: 'license' | 'rc' | 'gov_id' | 'inspection' | 'selfie';
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
}

/** The 5 documents §3.1 requires before a driver can reach `pending`. */
export const REQUIRED_KYC_DOC_TYPES: readonly DriverDocumentFixture['docType'][] = [
  'license',
  'rc',
  'gov_id',
  'inspection',
  'selfie',
];

export interface DriverFixture {
  name: string;
  mobile: string;
  kycStatus: 'approved' | 'pending' | 'incomplete' | 'rejected' | 'suspended';
  vehicleClass: 'wheel_lift' | 'flatbed' | null;
  longDistance: boolean;
  rating: string | null;
  totalTrips: number;
  level: 'bronze' | 'silver' | 'gold' | 'platinum';
  /** Fleet pool share (driver side). Ignored for non-fleet drivers. */
  driverSharePct: number;
  /**
   * Phase 11's admin queue and driver-facing status screen both need real
   * content to render — an empty queue or a driver with zero documents proves
   * nothing. Only non-`approved` drivers carry these (an `approved` driver's
   * documents are no longer interesting to look at).
   */
  documents?: readonly DriverDocumentFixture[];
  /** Overall rejection note (`drivers.rejection_reason`) — set only for `rejected`. */
  rejectionReason?: string;
}

export const FLEET_DRIVERS: Record<FleetFixture['key'], readonly DriverFixture[]> = {
  lakshmi: [
    {
      name: 'Suresh Kumar',
      mobile: '+919845100001',
      kycStatus: 'approved',
      vehicleClass: 'flatbed',
      longDistance: true,
      rating: '4.8',
      totalTrips: 412,
      level: 'gold',
      driverSharePct: 80,
    },
    {
      name: 'Manoj Pillai',
      mobile: '+919845100002',
      kycStatus: 'approved',
      vehicleClass: 'wheel_lift',
      longDistance: false,
      rating: '4.6',
      totalTrips: 287,
      level: 'silver',
      driverSharePct: 80,
    },
    {
      name: 'Abdul Rasheed',
      mobile: '+919845100003',
      kycStatus: 'approved',
      vehicleClass: 'flatbed',
      longDistance: true,
      rating: '4.9',
      totalTrips: 655,
      level: 'platinum',
      driverSharePct: 85,
    },
    {
      name: 'Ravi Shetty',
      mobile: '+919845100004',
      kycStatus: 'approved',
      vehicleClass: 'flatbed',
      longDistance: false,
      rating: '4.4',
      totalTrips: 198,
      level: 'silver',
      driverSharePct: 80,
    },
    {
      name: 'Imran Sait',
      mobile: '+919845100005',
      kycStatus: 'approved',
      vehicleClass: 'wheel_lift',
      longDistance: false,
      rating: '4.7',
      totalTrips: 344,
      level: 'gold',
      driverSharePct: 80,
    },
    {
      name: 'Prakash Naik',
      mobile: '+919845100006',
      kycStatus: 'pending',
      vehicleClass: 'wheel_lift',
      longDistance: false,
      rating: null,
      totalTrips: 0,
      level: 'bronze',
      driverSharePct: 80,
      // All 5 submitted and awaiting a human — this is what "pending" means.
      documents: REQUIRED_KYC_DOC_TYPES.map((docType) => ({ docType, status: 'pending' })),
    },
    {
      name: 'Farhan Ali',
      mobile: '+919845100007',
      kycStatus: 'rejected',
      vehicleClass: 'wheel_lift',
      longDistance: false,
      rating: null,
      totalTrips: 0,
      level: 'bronze',
      driverSharePct: 80,
      rejectionReason: 'Driving licence photo is unreadable — please resubmit a clearer copy.',
      documents: [
        {
          docType: 'license',
          status: 'rejected',
          rejectionReason: 'Photo is blurry and the expiry date is not legible.',
        },
        { docType: 'rc', status: 'approved' },
        { docType: 'gov_id', status: 'approved' },
        { docType: 'inspection', status: 'approved' },
        { docType: 'selfie', status: 'approved' },
      ],
    },
  ],
  chr: [
    {
      name: 'Senthil Kumar',
      mobile: '+919845200001',
      kycStatus: 'approved',
      vehicleClass: 'flatbed',
      longDistance: true,
      rating: '4.7',
      totalTrips: 389,
      level: 'gold',
      driverSharePct: 80,
    },
    {
      name: 'Arun Prakash',
      mobile: '+919845200002',
      kycStatus: 'approved',
      vehicleClass: 'wheel_lift',
      longDistance: false,
      rating: '4.5',
      totalTrips: 240,
      level: 'silver',
      driverSharePct: 80,
    },
    {
      name: 'Karthik Raja',
      mobile: '+919845200003',
      kycStatus: 'approved',
      vehicleClass: 'flatbed',
      longDistance: false,
      rating: '4.6',
      totalTrips: 301,
      level: 'silver',
      driverSharePct: 80,
    },
    {
      name: 'Velu Muthu',
      mobile: '+919845200004',
      kycStatus: 'approved',
      vehicleClass: 'wheel_lift',
      longDistance: false,
      rating: '4.3',
      totalTrips: 152,
      level: 'bronze',
      driverSharePct: 80,
    },
    {
      name: 'Vijay Anand',
      mobile: '+919845200005',
      kycStatus: 'incomplete',
      vehicleClass: null,
      longDistance: false,
      rating: null,
      totalTrips: 0,
      level: 'bronze',
      driverSharePct: 80,
      // Still gathering documents — only 2 of 5 uploaded, never submitted.
      documents: [
        { docType: 'gov_id', status: 'pending' },
        { docType: 'selfie', status: 'pending' },
      ],
    },
    {
      name: 'Mohan Das',
      mobile: '+919845200006',
      kycStatus: 'suspended',
      vehicleClass: 'flatbed',
      longDistance: true,
      rating: '4.2',
      totalTrips: 96,
      level: 'bronze',
      driverSharePct: 80,
      // Suspension isn't a documents problem — everything they submitted passed.
      documents: REQUIRED_KYC_DOC_TYPES.map((docType) => ({ docType, status: 'approved' })),
    },
  ],
};

/** One independent (non-fleet) driver so the "fleetId is null" paths stay honest. */
export const INDEPENDENT_DRIVER: DriverFixture = {
  name: 'Ganesh Rao',
  mobile: '+919845300001',
  kycStatus: 'approved',
  vehicleClass: 'wheel_lift',
  longDistance: false,
  rating: '4.5',
  totalTrips: 210,
  level: 'silver',
  driverSharePct: 100,
};

export const CUSTOMER_NAMES: readonly string[] = [
  'Ramesh Iyer',
  'Priya Sharma',
  'Anil Reddy',
  'Kavitha Menon',
  'Rohit Verma',
  'Sneha Kulkarni',
  'Farhan Khan',
  'Deepa Nair',
  'Vikram Singh',
  'Ananya Das',
  'Sanjay Patil',
  'Meera Krishnan',
  'Arjun Hegde',
  'Pooja Agarwal',
  'Naveen Chandra',
  'Divya Bhat',
  'Rahul Joshi',
  'Swathi Rao',
  'Kiran Kumar',
  'Nithya Ramesh',
];

export const SERVICE_MIX: ReadonlyArray<
  readonly [
    service: 'tow' | 'battery' | 'flat_tyre' | 'fuel' | 'breakdown' | 'accident_recovery',
    weight: number,
  ]
> = [
  ['tow', 55],
  ['battery', 10],
  ['flat_tyre', 8],
  ['fuel', 7],
  ['breakdown', 10],
  ['accident_recovery', 10],
];

/**
 * W15 — the FAQ and legal pages the apps fetch (`GET /v1/content/:kind`).
 *
 * These replace the customer app's hardcoded help copy and its dead legal
 * links. Kept deliberately plain: the console can edit every word without a
 * release, which is the point, and the seed only has to be plausible.
 */
export const CONTENT_PAGES: ReadonlyArray<{
  slug: string;
  kind: 'faq' | 'legal';
  title: string;
  bodyMd: string;
  sortOrder: number;
}> = [
  {
    slug: 'booking-a-tow',
    kind: 'faq',
    title: 'How do I book a tow?',
    bodyMd:
      'Open the app, drop a pin where your vehicle is, and confirm the vehicle class. We price the trip before you book, then find the nearest available driver. You will see the driver and the truck once one accepts.',
    sortOrder: 1,
  },
  {
    slug: 'fare-calculation',
    kind: 'faq',
    title: 'How is the fare calculated?',
    bodyMd:
      'The fare is a base charge plus a distance charge for your vehicle class, with a night surcharge where it applies. The app shows the full breakdown before you confirm, and the driver cannot change it afterwards.',
    sortOrder: 2,
  },
  {
    slug: 'cancel-booking',
    kind: 'faq',
    title: 'Can I cancel a booking?',
    bodyMd:
      'Yes, any time before the job starts. If a driver is already on the way, a cancellation fee may apply and the app shows it before you confirm the cancellation.',
    sortOrder: 3,
  },
  {
    slug: 'payments',
    kind: 'faq',
    title: 'How do I pay?',
    bodyMd:
      'Pay in the app by UPI or card after the trip completes. The receipt appears under Bookings, and the invoice can be downloaded for expense claims.',
    sortOrder: 4,
  },
  {
    slug: 'track-driver',
    kind: 'faq',
    title: 'Where is my driver?',
    bodyMd:
      'The tracking screen follows the driver live once a job is assigned, with an ETA that updates along the route. Share the trip from that screen if somebody is waiting with the vehicle.',
    sortOrder: 5,
  },
  {
    slug: 'emergency-help',
    kind: 'faq',
    title: 'What if I need urgent help?',
    bodyMd:
      'Use the SOS button in the app — it alerts our operations desk and your emergency contacts with your location. Add emergency contacts in Account → Emergency contacts before you need them.',
    sortOrder: 6,
  },
  {
    slug: 'privacy-policy',
    kind: 'legal',
    title: 'Privacy Policy',
    bodyMd:
      "We collect what a recovery job needs: your account details, the pickup and drop locations, and the driver's progress. Location is shared with the assigned driver only while the job is active. You can export or delete your data from Account → Privacy. This is the seeded copy — replace it with the reviewed policy before launch.",
    sortOrder: 1,
  },
  {
    slug: 'terms-of-service',
    kind: 'legal',
    title: 'Terms of Service',
    bodyMd:
      'By booking a recovery you confirm the vehicle is yours or that you are authorised to move it, and that the details you gave us are accurate. Fares, cancellation fees and the service limitations are described in the app before you confirm. This is the seeded copy — replace it with the reviewed terms before launch.',
    sortOrder: 2,
  },
];

export function centroid(areas: FleetFixture['areas']): LatLng {
  const lat = areas.reduce((s, a) => s + a[1], 0) / areas.length;
  const lng = areas.reduce((s, a) => s + a[2], 0) / areas.length;
  return { lat, lng };
}
