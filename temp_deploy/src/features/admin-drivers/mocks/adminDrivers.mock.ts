import type { AdminPendingDriver } from '../types';

/** A 1x1 placeholder — mirrors what the seed writes to disk for the real backend's demo data. */
const PLACEHOLDER_THUMB =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export const adminDriversMock: AdminPendingDriver[] = [
  {
    id: 'admin-mock-driver-1',
    name: 'Prakash Naik',
    mobile: '+91 91480 33445',
    vehicleClass: 'wheel_lift',
    longDistanceEnabled: false,
    kycSubmittedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    documents: [
      { id: 'doc-1a', docType: 'license', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-1b', docType: 'rc', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-1c', docType: 'gov_id', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-1d', docType: 'inspection', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-1e', docType: 'selfie', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
    ],
  },
  {
    id: 'admin-mock-driver-2',
    name: 'Meena Iyer',
    mobile: '+91 90080 12233',
    vehicleClass: 'flatbed',
    longDistanceEnabled: true,
    kycSubmittedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    documents: [
      { id: 'doc-2a', docType: 'license', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-2b', docType: 'rc', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-2c', docType: 'gov_id', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-2d', docType: 'inspection', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
      { id: 'doc-2e', docType: 'selfie', status: 'pending', rejectionReason: null, thumbnailUrl: PLACEHOLDER_THUMB },
    ],
  },
];
