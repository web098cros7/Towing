'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { AdminUsersDirectory } from '@/features/admin-directory/components/AdminUsersDirectory';

/**
 * `/admin/users` — W6's customer directory (§9.4.4): search, status filter,
 * suspend, and the suspension requests inbox as its own tab.
 */
export default function AdminUsersPage() {
  const can = useAdminCan();

  if (!can('user.read')) {
    return (
      <div>
        <PageHeader title="Users" description="Every customer account on the platform." />
        <AdminForbidden resource="the customer directory" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description="Find any account by partial name, exact mobile or id, and see its full history."
      />
      <AdminUsersDirectory />
    </div>
  );
}
