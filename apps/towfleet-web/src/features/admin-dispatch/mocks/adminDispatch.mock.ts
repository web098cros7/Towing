import type { AdminDispatchConfig, AppConfig } from '@towing/api-contracts';

/**
 * W12's dispatch screen against the seeded marketplace: the launch weights, one
 * tuned zone and one untuned, all three kill switches off, and no banner.
 */
export const adminDispatchConfigMock: AdminDispatchConfig = {
  global: {
    weights: { proximity: 60, rating: 15, acceptance: 15, completion: 10 },
    stalePingSeconds: 15,
    oneActiveBookingPerCustomer: true,
    blockOnUnpaidBalance: true,
    redispatchPriority: 'front',
    pingOnJobMs: 3_000,
    pingIdleMs: 10_000,
    perServiceMaxOffers: null,
  },
  zones: [
    {
      zoneId: '11111111-1111-4111-8111-111111111111',
      zoneName: 'Bengaluru Metro',
      isActive: true,
      override: { radiusLadderKm: [2, 4, 7, 10, 15], offersPerWave: 3 },
      resolved: {
        radiusLadderKm: [2, 4, 7, 10, 15],
        bandCRadiusLadderKm: [10, 25, 50],
        offerTimeoutSeconds: 20,
        offersPerWave: 3,
        maxSearchSeconds: 180,
      },
    },
    {
      zoneId: '22222222-2222-4222-8222-222222222222',
      zoneName: 'NH-44 corridor',
      isActive: true,
      // Never tuned: the form must submit the OVERRIDE, never the resolved
      // values, or the first save would freeze today's defaults as explicit
      // settings.
      override: null,
      resolved: {
        radiusLadderKm: [2, 4, 7, 10, 15],
        bandCRadiusLadderKm: [10, 25, 50],
        offerTimeoutSeconds: 20,
        offersPerWave: 3,
        maxSearchSeconds: 180,
      },
    },
  ],
  killSwitches: {
    pausedZoneIds: [],
    longDistanceDisabled: false,
    forcePolling: false,
    // W14 (G11): standalone SOS is ON unless an operator turns it off.
    sosStandaloneDisabled: false,
  },
};

export const adminAppConfigMock: AppConfig = {
  minCustomerVersion: '1.0.0',
  minDriverVersion: '1.0.0',
  forceUpgrade: false,
  sevLevel: null,
  sevMessage: null,
  sevUpdatedAt: null,
};
