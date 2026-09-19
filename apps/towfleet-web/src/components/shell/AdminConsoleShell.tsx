'use client';

import type { ReactNode } from 'react';
import { AdminRealtimeProvider } from '@/features/admin-realtime/AdminRealtimeProvider';
import { ToastProvider } from '@/components/admin/ToastProvider';
import { useAdminIdleLogout } from '@/components/admin/useAdminIdleLogout';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

/**
 * The W1 console shell (§3.2): permission-filtered sidebar + topbar + main,
 * with toasts, the 30-minute idle logout and the `/admin` socket connection
 * mounted once for the whole subtree.
 *
 * A client component because three of those four things hold state or timers;
 * the layout above it stays a server component so the route tree keeps its
 * server boundary.
 */
export function AdminConsoleShell({ children }: { children: ReactNode }): ReactNode {
  useAdminIdleLogout();

  return (
    <AdminRealtimeProvider>
      <ToastProvider>
        <div className="flex min-h-screen">
          <AdminSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <AdminTopbar />
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </ToastProvider>
    </AdminRealtimeProvider>
  );
}
