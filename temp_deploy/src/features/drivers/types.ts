export type KycStatus = 'pending' | 'approved' | 'rejected' | 'incomplete' | 'suspended';

export type FleetDriver = {
  id: string;
  name: string;
  phone: string;
  kycStatus: KycStatus;
  isOnline: boolean;
  assignedTruckPlate: string | null;
  rating: number | null;
  tripsTotal: number;
  monthNetPaise: number;
};

export const KYC_LABEL: Record<KycStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  incomplete: 'Incomplete',
  suspended: 'Suspended',
};
