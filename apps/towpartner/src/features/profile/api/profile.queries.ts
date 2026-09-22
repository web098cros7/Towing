import { useQuery } from '@tanstack/react-query';
import { profileDataSource } from './profileDataSource';
import { profileKeys } from './profile.keys';

/** The signed-in driver's profile (Figma driver "Profile"). */
export function useDriverProfile() {
  return useQuery({
    queryKey: profileKeys.card(),
    queryFn: () => profileDataSource.getProfile(),
  });
}

/** The raw `driver/me` contract, for Personal Information. */
export function useDriverMe() {
  return useQuery({
    queryKey: profileKeys.me(),
    queryFn: () => profileDataSource.getMe(),
  });
}
