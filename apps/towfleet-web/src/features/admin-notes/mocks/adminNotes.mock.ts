import type { AdminNote } from '@towing/api-contracts';

/**
 * W21 fixture — notes on the KYC queue's first driver.
 *
 * SUBJECT ID IS THE MOCK DRIVER'S, not a uuid: `adminDrivers.mock.ts` predates
 * the uuid convention and uses `admin-mock-driver-1`. The mock source matches
 * on whatever subject id the panel is given, so this fixture must agree with
 * THAT mock — a real backend row would carry a uuid, and the REST path is what
 * proves it.
 *
 * Authors are W2's mock admins (7…/8…), not the signed-in mock identity
 * (`0000…0001`), so the delete affordance is correctly hidden for the person
 * looking at it — which is the behaviour the panel should show in mocks.
 */
export const adminNotesMock: AdminNote[] = [
  {
    id: 'd0000001-0001-4000-8000-000000000001',
    subjectType: 'driver',
    subjectId: 'admin-mock-driver-1',
    adminId: '88888888-8888-4888-8888-888888888888',
    body: 'Called the driver — the RC photo is of the older vehicle. A fresh photo was requested.',
    pinned: true,
    createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  },
  {
    id: 'd0000002-0002-4000-8000-000000000002',
    subjectType: 'driver',
    subjectId: 'admin-mock-driver-1',
    adminId: '77777777-7777-4777-8777-777777777777',
    body: 'Selfie is blurry; re-upload requested on the verification call.',
    pinned: false,
    createdAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
  },
];
