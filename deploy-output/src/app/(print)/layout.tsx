import { QueryProvider } from '@/providers/QueryProvider';
import './print.css';

/**
 * PDF v1 = a print-optimized route, not a PDF library.
 *
 * A route GROUP rather than `?print=1` on `/earnings`: the console layout is a
 * flex shell with a fixed sidebar and a topbar, and suppressing that with print
 * CSS would mean `print:hidden` scattered across shell components that have
 * nothing to do with statements. The statement also wants a different structure
 * — letterhead, period, totals — so sharing the console's is a fight, not a
 * saving.
 *
 * No `RealtimeProvider` and no chrome. `middleware.ts`'s matcher already covers
 * `/statement/*`, so the page is session-guarded for free.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="mx-auto max-w-4xl bg-white p-8 text-black">{children}</div>
    </QueryProvider>
  );
}
