'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@towing/web-ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';

/**
 * §9.4's admin shell.
 *
 * Two pages and a way to reach both: Phase 11's KYC queue and §9.4.10's
 * Finance queue. A6 removed the hardcoded `/admin/drivers` landing (here,
 * `middleware.ts`, `app/admin/page.tsx`) that used to drop every sub-role —
 * including finance, who gets a 403 from the KYC queue — onto that one page.
 * Everyone lands on `/admin` now; role-aware routing arrives with A7.
 */
const LINKS = [
  { href: '/admin/drivers', label: 'KYC queue' },
  { href: '/admin/finance', label: 'Payouts' },
] as const;

export function AdminTopbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { admin } = useAdminIdentity();

  const logout = async () => {
    await fetch('/api/admin-session', { method: 'DELETE' });
    router.replace('/admin/login');
    router.refresh();
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-6">
        <span className="font-display text-lg font-bold text-brand">Towing Admin</span>

        <nav className="flex items-center gap-1" aria-label="Admin sections">
          {LINKS.map((link) => {
            const active = pathname?.startsWith(link.href) ?? false;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-brand'
                    : 'rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary'
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        {admin ? (
          <span className="text-sm text-text-secondary" data-testid="admin-identity">
            {admin.name} · {admin.subRole}
          </span>
        ) : null}
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={logout} aria-label="Log out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
