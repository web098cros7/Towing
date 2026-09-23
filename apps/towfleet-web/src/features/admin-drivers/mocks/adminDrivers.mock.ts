import type {
  AdminDriverDocument,
  AdminDocumentVersion,
  AdminPendingDriver,
  DocReviewStatus,
} from '../types';

/** A 1x1 placeholder — mirrors what the seed writes to disk for the real backend's demo data. */
const PLACEHOLDER_THUMB =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** W7 uploads are the only writer of this in the real system; here it is a tiny helper. */
export function mockVersionFallback(doc: AdminDriverDocument): AdminDocumentVersion {
  return {
    id: `version-${doc.id}`,
    docType: doc.docType,
    status: doc.status,
    rejectionReason: doc.rejectionReason,
    verifiedBy: doc.status === 'pending' ? null : 'mock-admin-1',
    verifiedAt: doc.status === 'pending' ? null : new Date(Date.now() - 3_600_000).toISOString(),
    supersededAt: null,
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    thumbnailUrl: doc.thumbnailUrl,
  };
}

const DOC_TYPES = ['license', 'rc', 'gov_id', 'inspection', 'selfie'] as const;

function documentsFor(
  driverIndex: number,
  statuses: Partial<Record<(typeof DOC_TYPES)[number], DocReviewStatus>> = {},
): AdminDriverDocument[] {
  return DOC_TYPES.map((docType, docIndex) => ({
    id: `doc-${driverIndex}${String.fromCharCode(97 + docIndex)}`,
    docType,
    status: statuses[docType] ?? 'pending',
    rejectionReason: statuses[docType] === 'rejected' ? 'Photo is blurred — please re-upload' : null,
    thumbnailUrl: PLACEHOLDER_THUMB,
  }));
}

const NAMES: Array<[string, string, 'wheel_lift' | 'flatbed', boolean]> = [
  ['Prakash Naik', '+91 91480 33445', 'wheel_lift', false],
  ['Meena Iyer', '+91 90080 12233', 'flatbed', true],
  ['Sadiq Basha', '+91 98861 55410', 'flatbed', false],
  ['Lakshmi Menon', '+91 97408 77210', 'wheel_lift', false],
  ['Ravi Shankar', '+91 90350 61902', 'flatbed', true],
  ['Anita Desai', '+91 98450 33871', 'wheel_lift', false],
  ['Faizal Rahman', '+91 99862 12044', 'flatbed', false],
  ['Geeta Pillai', '+91 97419 55027', 'wheel_lift', false],
  ['Naveen Kulkarni', '+91 90082 74190', 'flatbed', false],
  ['Sunita Reddy', '+91 98452 61038', 'wheel_lift', true],
  ['Arvind Bhatt', '+91 99725 88104', 'flatbed', false],
  ['Tara Krishnan', '+91 90190 44263', 'wheel_lift', false],
];

export const adminDriversMock: AdminPendingDriver[] = NAMES.map(
  ([name, mobile, vehicleClass, longDistanceEnabled], index) => {
    const submittedAt = new Date(Date.now() - (2 + index) * 3_600_000).toISOString();
    return {
      id: `admin-mock-driver-${index + 1}`,
      name,
      mobile,
      vehicleClass,
      longDistanceEnabled,
      // Every other driver ticked all five; the rest only tow.
      services: index % 2 === 0 ? ['battery', 'flat_tyre', 'fuel', 'lockout', 'breakdown'] : [],
      kycSubmittedAt: submittedAt,
      // W7's "GPS on map" is the LAST KNOWN location. Driver 1 pinged in
      // Bengaluru; driver 2 never did — both states ship so the drawer's two
      // renderings are reachable mocks-on.
      lastKnownLocation:
        index === 0
          ? { lat: 12.9716, lng: 77.5946, at: new Date(Date.now() - 4 * 60_000).toISOString() }
          : index === 3
            ? { lat: 13.0827, lng: 80.2707, at: new Date(Date.now() - 11 * 60_000).toISOString() }
            : null,
      // One rejected document on driver 2 so per-document review has something
      // to look at, and driver 5 is already clean.
      documents: documentsFor(index + 1, index === 1 ? { rc: 'rejected' } : {}),
    };
  },
);

/**
 * Stateful mocks-on bookkeeping: a decided driver leaves the queue, like the
 * real one, so a bulk selection visibly shrinks the list it came from.
 */
export const mockDecidedDrivers = new Set<string>();

/** Sentinel reason that makes the FIRST selected driver fail — see the data source. */
export const mockPartialFailure = 'mock-partial-failure';

/**
 * W7's history, for the two drivers the mocks-on specs open: the default
 * fallback gives everyone one version per document, and driver 1's licence went
 * through a resubmission, which is the case the panel exists for.
 */
export const adminDriversMockVersions: Record<string, AdminDocumentVersion[]> = {
  'admin-mock-driver-1': adminDriversMock[0]!.documents.flatMap((doc) =>
    doc.docType === 'license'
      ? [
          // Newest first, like the API: the file currently on review…
          mockVersionFallback(doc),
          // …and the one it replaced after a rejection.
          {
            ...mockVersionFallback(doc),
            id: 'version-doc-1a-old',
            status: 'rejected' as const,
            rejectionReason: 'Glare over the licence number',
            verifiedBy: 'mock-admin-2',
            verifiedAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
            supersededAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
            createdAt: new Date(Date.now() - 40 * 3_600_000).toISOString(),
          },
        ]
      : [mockVersionFallback(doc)],
  ),
};
