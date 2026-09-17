import { AdminTopbar } from '@/components/shell/AdminTopbar';

/**
 * Admin console shell (Phase 11). Deliberately no sidebar: the whole console
 * is one page (the KYC queue) until Phase 20's live-ops surface adds more.
 *
 * Data + identity providers live one level up in `app/admin/layout.tsx` (A7),
 * shared with the login page and the landing.
 */
export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AdminTopbar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
