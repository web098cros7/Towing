import { FleetConsoleShell } from '@/components/shell/FleetConsoleShell';
import { RealtimeProvider } from '@/features/realtime/RealtimeProvider';
import { QueryProvider } from '@/providers/QueryProvider';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      {/* Inside QueryProvider: the socket patches the query cache directly. */}
      <RealtimeProvider>
        <FleetConsoleShell>{children}</FleetConsoleShell>
      </RealtimeProvider>
    </QueryProvider>
  );
}
