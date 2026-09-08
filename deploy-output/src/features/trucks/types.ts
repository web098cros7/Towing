export type TruckStatus = 'active' | 'inactive' | 'non_compliant';
export type TruckType = 'wheel_lift' | 'flatbed';
export type ComplianceDocType = 'insurance' | 'rc' | 'puc' | 'permit';
export type ComplianceDocStatus = 'valid' | 'expiring' | 'expired' | 'missing';

export type ComplianceDoc = {
  id: string;
  docType: ComplianceDocType;
  issuedAt: string | null;
  expiresAt: string | null;
  status: ComplianceDocStatus;
};

export type LatLng = { lat: number; lng: number };

export type Truck = {
  id: string;
  plate: string;
  type: TruckType;
  capacityTons: number;
  status: TruckStatus;
  assignedDriverName: string | null;
  /**
   * Last PERSISTED position — `truckSchema` has carried these since Phase 4.
   * The live map does not read them: it uses the realtime snapshot, which
   * prefers the hot Redis position over this ~10s-lagged flush.
   */
  currentLocation: LatLng | null;
  lastPingAt: string | null;
  compliance: ComplianceDoc[];
};

export const TRUCK_TYPE_LABEL: Record<TruckType, string> = {
  wheel_lift: 'Wheel-lift',
  flatbed: 'Flatbed',
};

export const DOC_TYPE_LABEL: Record<ComplianceDocType, string> = {
  insurance: 'Insurance',
  rc: 'RC',
  puc: 'PUC',
  permit: 'Permit',
};
