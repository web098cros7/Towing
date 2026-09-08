import { SidebarNav } from '@/components/shell/SidebarNav';
import { Topbar } from '@/components/shell/Topbar';
import { RealtimeProvider } from '@/features/realtime/RealtimeProvider';
import { QueryProvider } from '@/providers/QueryProvider';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      {/* Inside QueryProvider: the socket patches the query cache directly. */}
      <RealtimeProvider>
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card px-3 py-5 lg:flex">
            <div className="mb-6 px-3">
              <span className="font-display text-xl font-bold text-brand">TowFleet</span>
            </div>
            <SidebarNav />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </RealtimeProvider>
    </QueryProvider>
  );
}
