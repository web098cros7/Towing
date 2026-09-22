import type {
  AdminAppConfigUpdate,
  AdminDispatchConfig,
  AdminDispatchConfigUpdate,
  AppConfig,
  DispatchConfigOverride,
} from '@towing/api-contracts';
import { adminApiFetch } from '@/lib/adminApiClient';
import { env } from '@/lib/env';
import { mockDelay, resolveMock } from '@/lib/mockUtils';
import { adminAppConfigMock, adminDispatchConfigMock } from '../mocks/adminDispatch.mock';

/**
 * W12's `/admin/dispatch`.
 *
 * ONE ROUTE, THREE PANELS, and each panel sends only its own keys: the update
 * schema is partial with no defaults, so a panel that submitted "everything"
 * would overwrite a colleague's edit it never showed.
 */
export interface AdminDispatchDataSource {
  config(): Promise<AdminDispatchConfig>;
  /** Global knobs: weights, toggles, ping cadence, re-dispatch priority, offers. */
  updateGlobal(patch: AdminDispatchConfigUpdate): Promise<AdminDispatchConfig>;
  /** `null` CLEARS a zone's override — different from omitting the zone. */
  updateZone(zoneId: string, override: DispatchConfigOverride | null): Promise<AdminDispatchConfig>;
  updateKillSwitches(patch: {
    pausedZoneIds?: string[];
    longDistanceDisabled?: boolean;
    forcePolling?: boolean;
    sosStandaloneDisabled?: boolean;
  }): Promise<AdminDispatchConfig>;
  appConfig(): Promise<AppConfig>;
  updateAppConfig(patch: AdminAppConfigUpdate): Promise<AppConfig>;
}

/** Mocks apply config edits so the preview behaves (the finance/pricing precedent). */
let mockConfig: AdminDispatchConfig = adminDispatchConfigMock;
let mockAppConfig: AppConfig = adminAppConfigMock;

const mockSource: AdminDispatchDataSource = {
  config: () => resolveMock(env.mockAdminDispatchState, mockConfig, mockConfig),

  updateGlobal: async (patch) => {
    await mockDelay();
    const { zones: _zones, killSwitches: _killSwitches, reason: _reason, ...global } = patch;
    mockConfig = { ...mockConfig, global: { ...mockConfig.global, ...global } };
    return mockConfig;
  },

  updateZone: async (zoneId, override) => {
    await mockDelay();
    mockConfig = {
      ...mockConfig,
      zones: mockConfig.zones.map((zone) =>
        zone.zoneId === zoneId ? { ...zone, override } : zone,
      ),
    };
    return mockConfig;
  },

  updateKillSwitches: async (patch) => {
    await mockDelay();
    mockConfig = {
      ...mockConfig,
      killSwitches: { ...mockConfig.killSwitches, ...patch },
    };
    return mockConfig;
  },

  appConfig: () => resolveMock(env.mockAdminDispatchState, mockAppConfig, mockAppConfig),
  updateAppConfig: async (patch) => {
    await mockDelay();
    mockAppConfig = {
      ...mockAppConfig,
      ...(patch.minCustomerVersion !== undefined
        ? { minCustomerVersion: patch.minCustomerVersion }
        : {}),
      ...(patch.minDriverVersion !== undefined ? { minDriverVersion: patch.minDriverVersion } : {}),
      ...(patch.forceUpgrade !== undefined ? { forceUpgrade: patch.forceUpgrade } : {}),
      ...(patch.sevLevel !== undefined
        ? {
            sevLevel: patch.sevLevel,
            sevMessage: patch.sevLevel === null ? null : (patch.sevMessage ?? null),
            sevUpdatedAt: patch.sevLevel === null ? null : new Date().toISOString(),
          }
        : {}),
    };
    return mockAppConfig;
  },
};

const restSource: AdminDispatchDataSource = {
  config: () => adminApiFetch<AdminDispatchConfig>('dispatch-config'),
  updateGlobal: (patch) =>
    adminApiFetch<AdminDispatchConfig>('dispatch-config', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  updateZone: (zoneId, override) =>
    adminApiFetch<AdminDispatchConfig>('dispatch-config', {
      method: 'PUT',
      body: JSON.stringify({ zones: [{ zoneId, override }] }),
    }),
  updateKillSwitches: (patch) =>
    adminApiFetch<AdminDispatchConfig>('dispatch-config', {
      method: 'PUT',
      body: JSON.stringify({ killSwitches: patch }),
    }),
  appConfig: () => adminApiFetch<AppConfig>('app-config'),
  updateAppConfig: (patch) =>
    adminApiFetch<AppConfig>('app-config', { method: 'PUT', body: JSON.stringify(patch) }),
};

export const adminDispatchDataSource: AdminDispatchDataSource = env.useMocks
  ? mockSource
  : restSource;
