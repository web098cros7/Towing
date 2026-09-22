'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { useAdminCan } from '@/components/admin/Can';
import { SupportThread } from '@/features/admin-support/components/SupportThread';

/** `/admin/support/[id]` — one ticket's whole life (§9.4.12). */
export default function AdminSupportThreadPage() {
  const can = useAdminCan();
  const params = useParams<{ id: string }>();
  const ticketId = params?.id ?? null;

  if (!can('ticket.handle')) {
    return (
      <div>
        <PageHeader title="Ticket" description="One ticket, every step." />
        <AdminForbidden resource="this ticket" />
      </div>
    );
  }
  if (!ticketId) return null;

  return (
    <div>
      <Link className="mb-3 inline-block text-sm text-brand hover:underline" href="/admin/support">
        ← All tickets
      </Link>
      <SupportThread ticketId={ticketId} />
    </div>
  );
}
