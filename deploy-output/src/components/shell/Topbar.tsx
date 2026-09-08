'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@towing/web-ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { RealtimeStatusChip } from '@/features/realtime/components/RealtimeStatusChip';

export function Topbar({ title }: { title?: string }) {
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/session', { method: 'DELETE' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="text-sm font-semibold text-text-primary">{title ?? ''}</div>
      <div className="flex items-center gap-2">
        <RealtimeStatusChip />
        <span className="hidden text-sm text-text-secondary md:block">
          Lakshmi Recovery Services
        </span>
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={logout} aria-label="Log out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
