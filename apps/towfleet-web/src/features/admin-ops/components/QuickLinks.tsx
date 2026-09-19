'use client';

import Link from 'next/link';
import { Card, CardContent } from '@towing/web-ui';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';

/**
 * The neutral quick-links view (A6/M0-F7), kept for the one sub-role that does
 * not hold `ops.live`.
 *
 * W3 turns `/admin` into the ops dashboard; finance would get a 403 panel on
 * the URL it lands on, and a redirect would re-introduce the role routing
 * M0-F7 removed. So finance keeps the cards that are actually its work.
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

export function AdminQuickLinks(): React.ReactNode {
  const { admin } = useAdminIdentity();

  const visible = admin
    ? SECTIONS.filter((section) => (section.roles as readonly string[]).includes(admin.subRole))
    : SECTIONS;

  return (
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
  );
}
