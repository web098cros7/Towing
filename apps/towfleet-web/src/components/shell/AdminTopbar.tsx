'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@towing/web-ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAdminIdentity } from '@/components/admin/AdminIdentityProvider';

/**
 * The console's topbar (W1 §3.2).
 *
 * The two section links it used to carry (KYC queue, Payouts) moved to
 * `AdminSidebar` — one navigation surface, filtered by permission, instead of
 * a topbar that only grew. What stays: brand, the signed-in identity, the
 * theme toggle and logout.
 */
export function AdminTopbar() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { admin } = useAdminIdentity();

  const logout = async () => {
    await fetch('/api/admin-session', { method: 'DELETE' });
    // M0-F2: clear the whole query cache — identity AND queue rows. Without
    // this the next admin in the same tab sees the previous admin's identity
    // and cached rows (driver PII, bank data).
    queryClient.clear();
    router.replace('/admin/login');
    router.refresh();
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <span className="font-display text-lg font-bold text-brand">Towing Admin</span>

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
