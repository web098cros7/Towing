import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { capabilitiesDataSource } from './capabilitiesDataSource';

export const capabilitiesKeys = {
  all: ['capabilities'] as const,
  mine: () => ['capabilities', 'mine'] as const,
};

/** The driver's current capabilities — seeds the screen on open. */
export function useCapabilities() {
  return useQuery({
    queryKey: capabilitiesKeys.mine(),
    queryFn: () => capabilitiesDataSource.get(),
  });
}

export function useUpdateCapabilities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: capabilitiesDataSource.update,
    onSuccess: (data) => queryClient.setQueryData(capabilitiesKeys.mine(), data),
  });
}
