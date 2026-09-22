/**
 * `?next=` safe destination for the admin login (A5).
 *
 * Same-origin admin path only: exactly `/admin` or under `/admin/`, never
 * starting `//` (protocol-relative), never containing a backslash (some
 * browsers treat `\` as `/`), and never containing a `..` segment
 * (`/admin/../login` normalises outside the admin realm — same-origin, so not
 * an open redirect, but out of the realm all the same). Anything else falls
 * back to `/admin` — the neutral A6 landing, which is correct for every
 * sub-role.
 */
export function safeAdminNext(raw: string | null): string {
  if (!raw) return '/admin';
  if (raw !== '/admin' && !raw.startsWith('/admin/')) return '/admin';
  if (raw.startsWith('//')) return '/admin';
  if (raw.includes('\\')) return '/admin';
  if (raw.split('/').includes('..')) return '/admin';
  return raw;
}
