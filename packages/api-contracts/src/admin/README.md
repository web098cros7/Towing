# Admin-realm contracts

The Towing Admin console's half of the API (spec §16.5, §9.4).

| File                                                     | Ships                                                                                                    | Phase |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----- |
| `auth.ts`                                                | Password → OTP admin login, session shape                                                                | 10    |
| `admin-users.ts`                                         | Admin user CRUD, TOTP, recovery codes (W2)                                                               | 10    |
| `audit.ts`                                               | Audit viewer rows + filters (W1)                                                                         | 20    |
| `directory.ts`                                           | Users/drivers/fleets directory, suspension, zone picker (W6)                                             | 20    |
| `notes.ts`                                               | Admin notes — ten subject types (W21)                                                                    | 20    |
| `bookings.ts`                                            | Bookings console: list/detail/timeline, cancel/reassign/override, invoice link, §14.2 interventions (W8) | 20    |
| `disputes.ts`                                            | Dispute queue + lifecycle, evidence, the five exits (W8)                                                 | 20    |
| `dispatch.ts` + `ops.ts` + `ops-kpis.ts` + `realtime.ts` | Ops dashboard KPI/badges, live map, dispatch inspector, `ops:*` frames (W3–W5)                           | 20    |
| `drivers.ts`                                             | KYC queue (paged), per-document review, versions, bulk decisions (W7)                                    | 11    |
| `zones.ts`                                               | Service-zone polygons + geofence settings (W13)                                                          | 20    |
| `sos.ts`                                                 | SOS queue/detail, acknowledge→contact→resolve, ops-raised alert, G12 broadcast (W14)                     | 20    |
| `support.ts`                                             | Support queue + thread, assign/status/message/note/link-booking (W15)                                    | 20    |
| `content.ts`                                             | FAQ + legal editor — list and the by-slug upsert (W15)                                                   | 20    |
| `impersonation.ts`                                       | Read-only app view sessions (G8)                                                                         | 20    |
| `pricing.ts`                                             | `GET/PUT /admin/pricing` · `GET/PUT /admin/commission` + history                                         | 14    |
| `finance.ts`                                             | Payout queue + finance config (Phase 11); refund primitives (W8); console reads land with W9             | 11/20 |
| `permissions.ts`                                         | The 36 permission ids + `ROLE_PERMISSIONS` (§4.2)                                                        | 20    |

Still unclaimed from the §16.5 table: `/admin/promos` (W16),
`/admin/analytics` (W17).
