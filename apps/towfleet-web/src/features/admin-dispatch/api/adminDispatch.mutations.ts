'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AdminAppConfigUpdate,
  AdminDispatchConfigUpdate,
  DispatchConfigOverride,
} from '@towing/api-contracts';
import { adminDispatchKeys } from './adminDispatch.keys';
import { adminDispatchDataSource } from './adminDispatchDataSource';

/** As everywhere a config write can time out after committing: no retry. */
export function useUpdateDispatchConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: AdminDispatchConfigUpdate) => adminDispatchDataSource.updateGlobal(patch),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminDispatchKeys.config(), config);
    },
  });
}

export function useUpdateZoneOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { zoneId: string; override: DispatchConfigOverride | null }) =>
      adminDispatchDataSource.updateZone(input.zoneId, input.override),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminDispatchKeys.config(), config);
    },
  });
}

/**
 * Kill switches are the one write here that can stop revenue, so the panel
 * confirms before calling this — but the mutation itself is ordinary.
 */
export function useUpdateKillSwitches() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: {
      pausedZoneIds?: string[];
      longDistanceDisabled?: boolean;
      forcePolling?: boolean;
    }) => adminDispatchDataSource.updateKillSwitches(patch),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminDispatchKeys.config(), config);
    },
  });
}

export function useUpdateAppConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: AdminAppConfigUpdate) => adminDispatchDataSource.updateAppConfig(patch),
    retry: false,
    onSuccess: (config) => {
      queryClient.setQueryData(adminDispatchKeys.appConfig(), config);
    },
  });
}
