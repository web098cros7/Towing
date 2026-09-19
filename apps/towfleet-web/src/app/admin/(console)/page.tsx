'use client';

import Link from 'next/link';
import { Card, CardContent } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';

/**
 * Admin landing (A6, neutral per M0-F7) + card filtering (A7).
 *
 * LIVES INSIDE `(console)` AS OF W1: it used to sit at `app/admin/page.tsx`,
 * a sibling of the console route group, so `/admin` — the one URL every admin
 * lands on — was the only screen without the shell. Moving it into the group
 * gives it the sidebar and topbar like every other console page; the URL is
 * unchanged (route groups do not appear in paths).
 *
 * NO role redirect: dropping every non-finance admin on the KYC queue
 * contradicts A6's "no admin is dropped on a queue". Cards for queues the
 * role would get a 403 on are hidden instead (support never sees payouts,
 * finance never sees the verification queue). W3 replaces this scaffolding
 * with the ops dashboard.
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
