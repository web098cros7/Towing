'use client';

import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { ContentEditor } from '@/features/admin-content/components/ContentEditor';

/** `/admin/content` — W15's FAQ + legal editor (§9.4.12 / §6.6). */
export default function AdminContentPage() {
  const can = useAdminCan();

  if (!can('content.edit')) {
    return (
      <div>
        <PageHeader title="Content" description="FAQ answers and legal pages." />
        <AdminForbidden resource="the content editor" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Content"
        description="What customers read in Help and Legal. Publishing is instant — the apps fetch these pages at runtime."
      />
      <ContentEditor />
    </div>
  );
}
