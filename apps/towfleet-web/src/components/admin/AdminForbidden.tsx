'use client';

import { Card, CardContent, ErrorState, Skeleton } from '@towing/web-ui';
import { useAdminIdentity } from './AdminIdentityProvider';

/**
 * The 403 panel (A7) — an explanation, not "Something went wrong on our
 * side". Rendered by admin screens when the API refuses with 403 OR when
 * the client-side permission map says no, but ONLY once the identity has
 * actually loaded. While it is still resolving it shows a skeleton, and if
 * it failed to load it says so with a retry.
 */
export function AdminForbidden({ resource }: { resource: string }) {
  const { admin, isError, retry } = useAdminIdentity();

  if (!admin && isError) {
    return (
      <div data-testid="admin-identity-error">
        <ErrorState
          title="Couldn't load your permissions"
          description="We couldn't confirm what this account may open. Please try again."
          onRetry={retry}
        />
      </div>
    );
  }

  // Permissions are still resolving: say nothing rather than deny something
  // the operator may hold.
  if (!admin) {
    return <Skeleton className="h-32" data-testid="admin-forbidden-pending" />;
  }

  return (
    <Card>
      <CardContent className="p-6" data-testid="admin-forbidden">
        <h2 className="font-display text-lg font-bold">You don&apos;t have access to {resource}</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {`Signed in as ${admin.name} (${admin.subRole}). Your sub-role does not include this queue — ask a super admin if you need it.`}
        </p>
      </CardContent>
    </Card>
  );
}
