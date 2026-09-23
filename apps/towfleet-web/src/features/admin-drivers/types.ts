import type { OptionalServiceType } from '@towing/api-contracts';

export type DocReviewStatus = 'pending' | 'approved' | 'rejected';
export type DriverDocType = 'license' | 'rc' | 'gov_id' | 'inspection' | 'selfie';
export type VehicleClass = 'wheel_lift' | 'flatbed';
export type KycStatus = 'pending' | 'incomplete' | 'approved' | 'rejected' | 'suspended';

/**
 * The driver app's own words for each roadside service, and the kit behind it,
 * so a reviewer reads exactly what the driver ticked.
 */
export const ROADSIDE_SERVICES: readonly { value: OptionalServiceType; label: string; kit: string }[] = [
  { value: 'battery', label: 'Jump start', kit: 'Jump pack or booster cables' },
  { value: 'flat_tyre', label: 'Flat tyre', kit: 'Jack and wheel spanner' },
  { value: 'fuel', label: 'Fuel delivery', kit: 'Approved fuel can' },
  { value: 'lockout', label: 'Car lockout', kit: 'Lockout kit' },
  { value: 'breakdown', label: 'Breakdown help', kit: 'Minor roadside repairs' },
  { value: 'winch_out', label: 'Winch out', kit: 'Working winch and recovery straps' },
];

export const DOC_TYPE_LABEL: Record<DriverDocType, string> = {
  license: 'Driving licence',
  rc: 'RC (registration)',
  gov_id: 'Government ID',
  inspection: 'Vehicle inspection',
  selfie: 'Selfie',
};

export type AdminDriverDocument = {
  id: string;
  docType: DriverDocType;
  status: DocReviewStatus;
  rejectionReason: string | null;
  thumbnailUrl: string;
};

/**
 * W7's "GPS on map", shipped as what the data is: the driver's LAST KNOWN
 * location, with the ping timestamp it came with. Capture-time document GPS is
 * a phase-2 contract change that also needs a driver-app release.
 */
export type AdminPendingDriverLocation = {
  lat: number;
  lng: number;
  at: string;
};

export type AdminPendingDriver = {
  id: string;
  name: string | null;
  mobile: string;
  vehicleClass: VehicleClass | null;
  longDistanceEnabled: boolean;
  /** The roadside services the driver says they can do. */
  services: OptionalServiceType[];
  kycSubmittedAt: string | null;
  lastKnownLocation: AdminPendingDriverLocation | null;
  documents: AdminDriverDocument[];
};

/** W7 paginated the queue — the one list that grows with supply. */
export type AdminPendingDriversPage = {
  items: AdminPendingDriver[];
  page: number;
  limit: number;
  total: number;
};

/** One upload of one document; `supersededAt` marks a file a resubmission replaced. */
export type AdminDocumentVersion = {
  id: string;
  docType: DriverDocType;
  status: DocReviewStatus;
  rejectionReason: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  thumbnailUrl: string;
};

export type KycDecision = 'approve' | 'reject' | 'request_info' | 'suspend' | 'reactivate';
export type KycBulkDecision = 'approve' | 'reject';

export type KycBulkItemResult = {
  driverId: string;
  ok: boolean;
  kycStatus: KycStatus | null;
  error: { code: string; message: string } | null;
};

export type KycBulkResult = {
  decision: KycBulkDecision;
  succeeded: number;
  failed: number;
  results: KycBulkItemResult[];
};
