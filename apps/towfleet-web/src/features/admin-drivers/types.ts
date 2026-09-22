export type DocReviewStatus = 'pending' | 'approved' | 'rejected';
export type DriverDocType = 'license' | 'rc' | 'gov_id' | 'inspection' | 'selfie';
export type VehicleClass = 'wheel_lift' | 'flatbed';
export type KycStatus = 'pending' | 'incomplete' | 'approved' | 'rejected' | 'suspended';

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
