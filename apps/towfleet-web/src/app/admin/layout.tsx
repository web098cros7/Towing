import { ThemeStyles, adminAccent } from '@towing/web-ui';

/**
 * Admin realm wrapper (A2).
 *
 * Scopes the admin accent (Signal Blue on charcoal, spec §10.3) to the
 * `/admin` subtree — including `/admin/login`, which lives outside
 * `(console)`. The root layout already emits the fleet accent on `:root`;
 * this block's `[data-realm="admin"]` declaration wins for the admin subtree
 * by inheritance, leaving the fleet console untouched.
 */
export default function AdminRealmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-realm="admin">
      <ThemeStyles accent={adminAccent} scope='[data-realm="admin"]' />
      {children}
    </div>
  );
}
