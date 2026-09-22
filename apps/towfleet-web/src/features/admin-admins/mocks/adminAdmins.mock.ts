import type { AdminAdminListItem } from '@towing/api-contracts';

/**
 * W2's admin directory fixture: one of each wieldable sub-role, so the
 * role filter and the last-super-admin copy have something to render.
 * Deterministic UUIDs, disjoint from every other admin mock.
 */
export const adminAdminsMock: AdminAdminListItem[] = [
  {
    id: '77777777-7777-4777-8777-777777777777',
    email: 'super@towing.local',
    name: 'Ananya Iyer',
    mobile: '+919845990001',
    subRole: 'super_admin',
    status: 'active',
    twofaEnabled: true,
    receivesOpsAlerts: true,
    mustChangePassword: false,
    lastLoginAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    email: 'ops@towing.local',
    name: 'Rohit Menon',
    mobile: '+919845990002',
    subRole: 'operations',
    status: 'active',
    twofaEnabled: false,
    receivesOpsAlerts: true,
    mustChangePassword: false,
    lastLoginAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'support@towing.local',
    name: 'Fatima Sheikh',
    mobile: '+919845990003',
    subRole: 'support',
    status: 'suspended',
    twofaEnabled: false,
    receivesOpsAlerts: false,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString(),
  },
];
