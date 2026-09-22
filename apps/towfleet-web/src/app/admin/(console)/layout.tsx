import { AdminConsoleShell } from '@/components/shell/AdminConsoleShell';

/**
 * Admin console shell (W1, §3.2). The old topbar-only layout ("deliberately no
 * sidebar: the whole console is one page") was true in Phase 11 and stopped
 * being true the moment the console grew a second section; the sidebar replaces
 * it, filtered by the SAME permission map the server enforces.
 *
 * Data + identity providers live one level up in `app/admin/layout.tsx` (A7),
 * shared with the login page and the landing. Toasts and the idle-logout timer
 * are mounted by `AdminConsoleShell` for every console page.
 */
export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AdminConsoleShell>{children}</AdminConsoleShell>;
}
