'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';

/**
 * Admin landing (A6) + role routing (A7).
 *
 * Finance goes to the payout queue; every other sub-role goes to the KYC
 * queue — the only two pages that exist. (The dashboard is W3; "otherwise the
 * dashboard" from the guide has nowhere to point yet, so operations and super
 * admin start on the KYC queue alongside support.) While identity resolves,
 * the neutral landing below holds — nobody is dropped on a queue uninvited.
 */
const SECTIONS = [
  {
    href: '/admin/drivers',
    title: 'Verification queue',
    description: 'Driver documents awaiting review.',
  },
  {
    href: '/admin/finance',
    title: 'Payout approvals',
    description: 'Driver and fleet payouts above the auto-approval threshold.',
  },
] as const;

export default function AdminIndexPage() {
  const router = useRouter();
  const { admin, isLoading } = useAdminIdentity();

  useEffect(() => {
    if (isLoading || !admin) return;
    router.replace(admin.subRole === 'finance' ? '/admin/finance' : '/admin/drivers');
  }, [admin, isLoading, router]);

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Platform operations console. Choose a queue to start working."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((section) => (
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
