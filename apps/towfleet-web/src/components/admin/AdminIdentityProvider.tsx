'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminIdentitySchema, type AdminIdentity } from '@towing/api-contracts';
import { TOTP_ENROLMENT_PATH } from '@/lib/adminApiClient';

interface AdminIdentityValue {
  admin: AdminIdentity | null;
  isLoading: boolean;
  /** True only once the query failed AND its one retry also failed (the BFF or backend answered 5xx). A 401 is not an error: it redirects to login. */
  isError: boolean;
  /** Re-run the identity query. */
  retry: () => void;
}

const AdminIdentityContext = createContext<AdminIdentityValue>({
  admin: null,
  isLoading: true,
  isError: false,
  retry: () => {},
});

async function fetchAdminIdentity(): Promise<AdminIdentity | null> {
  const res = await fetch('/api/admin-session', {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    // Session gone — but never bounce the login page off itself. Carry the
    // current page as `?next=` so a re-login lands back where the admin was
    // (the middleware does the same on its server-side bounce).
    if (typeof window !== 'undefined' && window.location.pathname !== '/admin/login') {
      const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.assign(`/admin/login?next=${next}`);
    }
    return null;
  }
  if (!res.ok) {
    throw new Error(`Admin session request failed (${res.status})`);
  }
  const body = (await res.json()) as { admin: unknown };
  return adminIdentitySchema.parse(body.admin);
}

/**
 * Identity for the admin console shell (A7).
 *
 * Any admin screen asks "what may this admin do" through
 * `useAdminIdentity()` — no second login. Mounted once in the admin realm
 * layout, above the console shell. Fine-grained permissions arrive with W1's
 * permission model; until then screens branch on `admin.subRole`.
 */
export function AdminIdentityProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const query = useQuery({
    queryKey: ['admin-identity'],
    queryFn: fetchAdminIdentity,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    // M0-F2: no identity query on the login page. It mounts under the realm
    // layout, and without this it caches `null` for 60 s — then a client-side
    // post-login navigation never receives the identity (ops stuck on
    // `/admin` because the role effect never fires).
    enabled: pathname !== '/admin/login',
  });

  const mustEnrol = query.data?.twofaEnrolmentRequired ?? false;
  useEffect(() => {
    if (mustEnrol && pathname !== TOTP_ENROLMENT_PATH) router.replace(TOTP_ENROLMENT_PATH);
  }, [mustEnrol, pathname, router]);

  return (
    <AdminIdentityContext.Provider
      value={{
        admin: query.data ?? null,
        isLoading: query.isLoading,
        isError: query.isError,
        retry: () => void query.refetch(),
      }}
    >
      {children}
    </AdminIdentityContext.Provider>
  );
}

export function useAdminIdentity(): AdminIdentityValue {
  return useContext(AdminIdentityContext);
}
