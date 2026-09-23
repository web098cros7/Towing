import { ApiClientError } from '@/lib/api/errors';
import { getMockKycStatus } from '@/features/kyc/api/kycMockSource';
import type { OptionalServiceType } from '../types';
import type { CapabilitiesDataSource } from './capabilitiesDataSource';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let mockVehicleClass: 'wheel_lift' | 'flatbed' | null = null;
let mockLongDistanceEnabled = false;
// Empty, like a real new driver's row — mocks-on, the services card opens
// with nothing ticked, which is the state onboarding has to be designed for.
let mockServices: OptionalServiceType[] = [];

export const capabilitiesMockSource: CapabilitiesDataSource = {
  async get() {
    await delay(200);
    return {
      vehicleClass: mockVehicleClass,
      longDistanceEnabled: mockLongDistanceEnabled,
      services: mockServices,
    };
  },
  async update(body) {
    await delay(300);
    // Mirrors `KycApprovedGuard`: this is the one route even a signed-in
    // driver can be turned away from mid-session.
    if (getMockKycStatus() !== 'approved') {
      throw new ApiClientError(403, 'forbidden', 'KYC approval required', { reason: 'kyc_not_approved' });
    }
    if (body.vehicleClass !== undefined) mockVehicleClass = body.vehicleClass;
    if (body.longDistanceEnabled !== undefined) mockLongDistanceEnabled = body.longDistanceEnabled;
    // The whole set, not a merge — same as the server, so an untick sticks.
    if (body.services !== undefined) mockServices = [...body.services];
    return {
      vehicleClass: mockVehicleClass,
      longDistanceEnabled: mockLongDistanceEnabled,
      services: mockServices,
    };
  },
};
