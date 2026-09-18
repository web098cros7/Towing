'use client';

import Link from 'next/link';
import { Card, CardContent } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';

/**
 * Admin landing (A6, neutral per M0-F7) + card filtering (A7).
 *
 * NO role redirect: dropping every non-finance admin on the KYC queue
 * contradicts A6's "no admin is dropped on a queue". Cards for queues the
 * role would get a 403 on are hidden instead (support never sees payouts,
 * finance never sees the verification queue). While identity resolves, all
 * cards show — the page is static scaffolding W3 replaces with the ops
 * dashboard, so keep it dumb and let nothing else depend on it.
 */
const SECTIONS = [
  {
    href: '/admin/drivers',
    title: 'Verification queue',
    description: 'Driver documents awaiting review.',
    roles: ['super_admin', 'operations', 'support'],
  },
  {
    href: '/admin/finance',
    title: 'Payout approvals',
    description: 'Driver and fleet payouts above the auto-approval threshold.',
    roles: ['super_admin', 'operations', 'finance'],
  },
] as const;

export default function AdminIndexPage() {
  const { admin } = useAdminIdentity();

  const visible = admin
    ? SECTIONS.filter((section) =>
        (section.roles as readonly string[]).includes(admin.subRole),
      )
    : SECTIONS;

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Platform operations console. Choose a queue to start working."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card>
              <CardContent className="p-6">
                <div className="font-semibold">{section.title}</div>
                <div className="mt-1 text-sm text-text-secondary">{section.description}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
