'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@towing/web-ui';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * §9.4's admin shell.
 *
 * ⚠ THIS HAD NO NAVIGATION AT ALL until Phase 19, because there was exactly one
 * admin page: Phase 11's KYC queue. §9.4.10's Finance queue is the second, and
 * a console with two pages and no way to reach the other one is a console with
 * one page.
 *
 * A RELATED GOTCHA, LEFT DELIBERATELY UNCHANGED: `middleware.ts` sends an
 * authenticated admin to `/admin/drivers`, hardcoded, because middleware cannot
 * read the sub-role out of an opaque session cookie. A `finance` admin
 * therefore lands on a queue they get a 403 from — which is why that page's
 * error state has to read as "you don't have access to this queue" rather than
 * "something went wrong", and why this bar has to make Finance obviously
 * reachable from there.
 */
const LINKS = [
  { href: '/admin/drivers', label: 'KYC queue' },
  { href: '/admin/finance', label: 'Payouts' },
] as const;

export function AdminTopbar() {
  const router = useRouter();
  const pathname = usePathname();

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
                    ? 'rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-text-primary'
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
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={logout} aria-label="Log out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
