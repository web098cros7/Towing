import { QueryProvider } from '@/providers/QueryProvider';

/**
 * §9.3.1's first-login wizard gets its own route group with minimal chrome:
 * no sidebar, no topbar, and deliberately **no `RealtimeProvider`** — a fleet
 * that has not finished onboarding has no trucks to track, so opening a socket
 * would be work in service of an empty map.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="min-h-screen bg-surface1">
        <header className="border-b border-border bg-card px-6 py-4">
          <span className="font-display text-xl font-bold text-brand">TowFleet</span>
        </header>
        <main className="mx-auto max-w-3xl p-6">{children}</main>
      </div>
    </QueryProvider>
  );
}
