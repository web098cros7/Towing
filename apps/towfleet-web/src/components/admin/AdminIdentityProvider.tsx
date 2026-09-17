'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminIdentitySchema, type AdminIdentity } from '@towing/api-contracts';

interface AdminIdentityValue {
  admin: AdminIdentity | null;
  isLoading: boolean;
}

const AdminIdentityContext = createContext<AdminIdentityValue>({
  admin: null,
  isLoading: true,
});

async function fetchAdminIdentity(): Promise<AdminIdentity | null> {
  const res = await fetch('/api/admin-session', {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    // Session gone — but never bounce the login page off itself.
    if (typeof window !== 'undefined' && window.location.pathname !== '/admin/login') {
      window.location.assign('/admin/login');
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
  const query = useQuery({
    queryKey: ['admin-identity'],
    queryFn: fetchAdminIdentity,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return (
    <AdminIdentityContext.Provider
      value={{ admin: query.data ?? null, isLoading: query.isLoading }}
    >
      {children}
    </AdminIdentityContext.Provider>
  );
}

export function useAdminIdentity(): AdminIdentityValue {
  return useContext(AdminIdentityContext);
}
