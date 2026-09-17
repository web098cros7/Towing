import Link from 'next/link';
import { Card, CardContent } from '@towing/web-ui';
import { PageHeader } from '@/components/PageHeader';

/**
 * Admin landing (A6) — deliberately neutral, not role-routed.
 *
 * Three places used to hardcode `/admin/drivers` as the landing (here,
 * the login page, `middleware.ts`), which dropped every finance admin onto
 * the KYC queue. Now everyone lands here and picks a queue; role-based
 * routing arrives with A7's identity provider.
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
