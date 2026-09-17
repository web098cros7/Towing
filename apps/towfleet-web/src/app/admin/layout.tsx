import { ThemeStyles, adminAccent } from '@towing/web-ui';
import { QueryProvider } from '@/providers/QueryProvider';
import { AdminIdentityProvider } from '@/components/admin/AdminIdentityProvider';

/**
 * Admin realm wrapper (A2).
 *
 * Scopes the admin accent (Signal Blue on charcoal, spec §10.3) to the
 * `/admin` subtree — including `/admin/login`, which lives outside
 * `(console)`. The root layout already emits the fleet accent on `:root`;
 * this block's `[data-realm="admin"]` declaration wins for the admin subtree
 * by inheritance, leaving the fleet console untouched.
 *
 * Also mounts the data + identity providers once for the whole realm (A7),
 * so the login page, the landing and the console share one query client and
 * one identity. The login page fires no identity query, so mounting here
 * does not bounce unauthenticated visitors.
 */
export default function AdminRealmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-realm="admin">
      <ThemeStyles accent={adminAccent} scope='[data-realm="admin"]' />
      <QueryProvider>
        <AdminIdentityProvider>{children}</AdminIdentityProvider>
      </QueryProvider>
    </div>
  );
}
