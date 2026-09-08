export type DocReviewStatus = 'pending' | 'approved' | 'rejected';
export type DriverDocType = 'license' | 'rc' | 'gov_id' | 'inspection' | 'selfie';
export type VehicleClass = 'wheel_lift' | 'flatbed';

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

export type AdminPendingDriver = {
  id: string;
  name: string | null;
  mobile: string;
  vehicleClass: VehicleClass | null;
  longDistanceEnabled: boolean;
  kycSubmittedAt: string | null;
  documents: AdminDriverDocument[];
};

export type KycDecision = 'approve' | 'reject' | 'request_info' | 'suspend' | 'reactivate';
