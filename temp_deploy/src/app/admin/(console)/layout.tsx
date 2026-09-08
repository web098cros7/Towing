import { AdminTopbar } from '@/components/shell/AdminTopbar';
import { QueryProvider } from '@/providers/QueryProvider';

/**
 * Admin console shell (Phase 11). Deliberately no sidebar: the whole console
 * is one page (the KYC queue) until Phase 20's live-ops surface adds more.
 */
export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="flex min-h-screen flex-col">
        <AdminTopbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </QueryProvider>
  );
}
