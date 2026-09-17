'use client';

import { Card, CardContent } from '@towing/web-ui';
import { useAdminIdentity } from './AdminIdentityProvider';

/**
 * The 403 panel (A7) — an explanation, not "Something went wrong on our
 * side". Rendered by admin screens when the API refuses with 403: the
 * operator holds a valid session and still may not see this queue.
 */
export function AdminForbidden({ resource }: { resource: string }) {
  const { admin } = useAdminIdentity();

  return (
    <Card>
      <CardContent className="p-6" data-testid="admin-forbidden">
        <h2 className="font-display text-lg font-bold">You don&apos;t have access to {resource}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {admin
            ? `Signed in as ${admin.name} (${admin.subRole}). Your sub-role does not include this queue — ask a super admin if you need it.`
            : 'Your session does not include this queue — ask a super admin if you need it.'}
        </p>
      </CardContent>
    </Card>
  );
}
