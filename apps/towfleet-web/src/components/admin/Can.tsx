'use client';

import { ROLE_PERMISSIONS, type AdminPermission } from '@towing/api-contracts';
import type { ReactNode } from 'react';
import { useAdminIdentity } from './AdminIdentityProvider';

/**
 * The web half of W1's "one permission map, two consumers" (§3.1).
 *
 * The SAME `ROLE_PERMISSIONS` table the backend guard reads is imported here —
 * a screen cannot drift from the server because there is only one list. What
 * this is NOT: an authorisation control. Hiding a button the API would refuse
 * is UX, not security (the guide's rule: "a hidden button is not an
 * authorisation control"); every gated route re-checks server-side.
 */
export function useAdminCan(): (permission: AdminPermission) => boolean {
  const { admin } = useAdminIdentity();
  return (permission) => (admin ? ROLE_PERMISSIONS[admin.subRole].includes(permission) : false);
}

export function Can({
  perm,
  children,
}: {
  perm: AdminPermission;
  children: ReactNode;
}): ReactNode {
  const can = useAdminCan();
  return can(perm) ? children : null;
}
