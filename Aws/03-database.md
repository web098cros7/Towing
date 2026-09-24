# 03 — Database: RDS Provisioning & Migrations

Everything an AWS engineer needs to provision PostgreSQL for the Towing platform and run its migrations. The backend (`apps/backend`, NestJS 11) is the only service that talks to the database; the TowFleet web console goes through the backend API.

## 1. At a glance

| Item | Value |
|---|---|
| Engine | PostgreSQL **16** (local dev image: `postgis/postgis:16-3.4`; schema snapshot was dumped from 16.4) |
| Required extension | **PostGIS 3.4** — the *only* extension the app itself requires (see §2) |
| ORM / driver | Drizzle ORM (`drizzle-orm ^0.45.2`) over **postgres.js** (`postgres ^3.4.9`) |
| Migrations | 45 SQL files, drizzle-kit format — **canonical location: `apps/backend/drizzle/`** (`Aws/migrations/` is a point-in-time copy) |
| Migration journal | Table `drizzle.__drizzle_migrations` (`id`, `hash`, `created_at`), created automatically by the migrator |
| Migration runner | `apps/backend/src/db/migrate.ts` via `pnpm --filter @towing/backend db:migrate` — dedicated single connection (`max: 1`) |
| App tables | 24 tables in schema `public`, 21 enums, all PKs `uuid DEFAULT gen_random_uuid()` (core Postgres, no extra extension needed) |
| Connection config | `DATABASE_URL` (validated `postgres://` or `postgresql://`), pool size `DATABASE_POOL_MAX` (default **10**), `prepare: false` |
| Local dev reference | `apps/backend/docker-compose.yml` — dev on 5432/6379, tmpfs test profile on 5433/6380, DB name `towfleet` |
| Seed | `pnpm --filter @towing/backend db:seed` — deterministic demo data; **refuses `NODE_ENV=production`** |

## 2. Engine requirements

- **PostgreSQL 16 with PostGIS 3.4.** The schema uses `geography(Point,4326)` (driver and truck live locations) and `geography(Polygon,4326)` (service-zone areas), plus GIST indexes on all three — see §6.
- **On RDS:** PostGIS is a supported extension on RDS for PostgreSQL 16; `CREATE EXTENSION postgis` works when run by a user holding the `rds_superuser` role (the RDS master user has it). Migration `0000_enable_postgis` runs exactly this — `CREATE EXTENSION IF NOT EXISTS postgis;` and nothing else — so running migrations as the master user (or a role granted the ability to create the extension) handles it with no manual step.
- **Only `postgis` is required.** The dev snapshot (`Aws/db/schema-snapshot.sql`) also shows `fuzzystrmatch`, `postgis_tiger_geocoder`, `postgis_topology` and the `tiger`, `tiger_data`, `topology` schemas. Those are installed automatically by the `postgis/postgis` Docker image's init scripts, not by the app's migrations — the app never references them. Do **not** treat them as requirements on RDS.
- UUID generation uses `gen_random_uuid()`, which is core Postgres since v13 — no `pgcrypto`/`uuid-ossp` needed.

## 3. How migrations work

Pipeline: TypeScript schema DSL → generated SQL → journaled runner.

1. **Authoring.** The schema lives in `apps/backend/src/db/schema/` (entry `index.ts`). `pnpm --filter @towing/backend db:generate` (drizzle-kit) diffs the DSL against the last snapshot and emits a new SQL file into `apps/backend/drizzle/`, plus a snapshot under `meta/`. Statements within a generated file are separated by `--> statement-breakpoint` markers, which the migrator uses to split execution. Migrations 0002 is fully hand-authored, and 0004, 0005, 0006 and 0007 each carry a hand-written tail (things the DSL can't express — GIST indexes, CHECK constraints, partial unique indexes); 0002 has no breakpoint markers and runs as one batch.
2. **Ordering.** `apps/backend/drizzle/meta/_journal.json` lists entries `idx` 0–43 with millisecond `when` timestamps; the migrator applies them in that order.
3. **Running.** `pnpm --filter @towing/backend db:migrate` executes `src/db/migrate.ts`: it loads `.env`/environment, opens a **dedicated postgres.js connection with `max: 1`** (migrations must run serially on one session so advisory locks and DDL transactions behave), calls the drizzle postgres-js migrator against `apps/backend/drizzle/`, prints `migrations applied`, and closes the connection. Exit code is non-zero on failure.
4. **Bookkeeping.** Applied migrations are recorded in `drizzle.__drizzle_migrations` (schema `drizzle` is created for you). The runner is idempotent — already-applied entries are skipped — so it is safe to run on every deploy before the app rolls out.
5. **drizzle-kit config** (`apps/backend/drizzle.config.ts`): dialect `postgresql`, schema `./src/db/schema/index.ts`, out `./drizzle`, and `tablesFilter: ['!spatial_ref_sys', '!geography_columns', '!geometry_columns']` — without that filter drizzle-kit would try to drop PostGIS-owned objects. Keep the filter if you ever run `db:generate` against a live database.

> **Never edit or rename a migration file after it has been applied anywhere.** The journal tracks entries by timestamp and content hash; editing an applied file causes silent drift between environments at best. Every schema change is a **new** file produced by `pnpm db:generate` (or a new hand-written file registered in `_journal.json`, following the 0002 pattern).

### Running migrations on AWS

Run as a one-off task (e.g. ECS `RunTask` with the backend image, command `pnpm --filter @towing/backend db:migrate`) as a pipeline step gated before the service deployment. Two packaging caveats:

- The runner is executed with `tsx`, which is a **devDependency** — the image (or a dedicated migration image) must include dev dependencies, or you must precompile `migrate.ts`.
- `migrate.ts` resolves the migrations folder relative to the source tree (`src/db/../../drizzle`), so `apps/backend/drizzle/` (including `meta/`) must be present in the image.

## 4. Migration files (0000–0007)

Read from `Aws/migrations/` (point-in-time copy; canonical is `apps/backend/drizzle/`).

| # | File | What it does |
|---|---|---|
| 0000 | `0000_enable_postgis.sql` | `CREATE EXTENSION IF NOT EXISTS postgis` — must run first, before any `geography(...)` column. No-op on a database where the extension already exists. |
| 0001 | `0001_core_schema.sql` | The core schema, drizzle-kit generated: **21 enums** (`booking_status`, `payment_status`, `wallet_txn_type`, `kyc_status`, `vehicle_class`, …), **22 tables** (all domains except fleet-owner auth), **22 FK constraints**, **29 btree indexes** — including the fleet feed pagination index `idx_bookings_fleet_feed` on `bookings (fleet_id, created_at DESC NULLS LAST, id DESC NULLS LAST)` (declared in the schema DSL), and unique constraints on `payments`/`payouts`/`wallet_transactions` `idempotency_key`, `wallets (owner_type, owner_id)`, `users.mobile`, `drivers.mobile`, `refresh_tokens.token_hash`. |
| 0002 | `0002_spatial_and_constraints.sql` | Hand-written — things the DSL cannot express: **3 GIST indexes** `idx_drivers_geo`, `idx_fleet_trucks_geo` (on `current_location`), `idx_service_zones_geo` (on `area`) that carry nearest-driver search and point-in-polygon checks; partial index `idx_compliance_documents_active_expiry` (`expires_at` where not expired) for the compliance expiry board; FK `fleet_driver_shares.driver_id → drivers.id` + unique `(fleet_id, driver_id)` pair; **8 money CHECK constraints** (see §6). |
| 0003 | `0003_fleet_credentials.sql` | Fleet-console auth: tables `fleet_owner_credentials` (unique `user_id` and `email`, lockout columns) and `login_challenges`, with 2 FKs to `users` and 2 indexes. |
| 0004 | `0004_petite_richard_fisk.sql` | Adds `drivers.assigned_truck_id` (FK → `fleet_trucks`, `ON DELETE SET NULL`); **partial unique index `uq_drivers_assigned_truck`** on `drivers (assigned_truck_id) WHERE assigned_truck_id IS NOT NULL` — one driver per truck, and the loser of two concurrent assigns gets error 23505; **unique `uq_fleet_trucks_fleet_plate` on `fleet_trucks (fleet_id, plate)`** — plates unique per fleet (Phase 6 bulk CSV import relies on it). |
| 0005 | `0005_aberrant_joshua_kane.sql` | Phase 6: `alerts` + `truck_imports`. Hand-written tail — **partial unique `uq_alerts_open_subject`** on unresolved rows (what makes the hourly compliance sweep idempotent) plus the partial feed index `idx_alerts_feed_open`. Do not regenerate without re-adding them. |
| 0006 | `0006_money_and_settings.sql` | Phase 7: the money domain. Hand-written tail — **partial unique `uq_payouts_one_open_per_owner`** (the database's own defeat of the concurrent double-payout, which holds with Redis down), the `ck_payout_accounts_*` CHECKs, and an idempotency-key backfill run before its `SET NOT NULL`. |
| 0007 | `0007_multi_realm_identity.sql` | Phase 10: four auth realms. Enums `admin_sub_role`, `social_provider`, and `'admin_login'` added to `otp_purpose` — safe inside the migrator's transaction **only because nothing in the file uses the new label** (see the banner comment). Tables `admin_users`, `admin_actions`, `social_identities`. Hand-written tail: **`login_challenges.user_id` → `subject_id` RENAME** with its FK to `users` dropped and a new `subject_type text NOT NULL` backfilled to `'user'` and CHECK-constrained to `('user','driver','admin')` — without which the first driver OTP login takes a 23503; `drivers.kyc_status` default `pending` → `incomplete`; `drivers.approved_by` and `driver_documents.verified_by` repointed from `users` to `admin_users`. |

## 5. Schema domain overview

24 application tables in `public`:

| Domain | Tables | Notes |
|---|---|---|
| Customers | `users`, `addresses`, `saved_vehicles`, `emergency_contacts` | `users` is also the identity row for fleet owners (`fleets.owner_id → users.id`). Child tables cascade on user delete. |
| Fleets & trucks | `fleets`, `fleet_trucks`, `compliance_documents`, `fleet_driver_shares` | Trucks carry `geography(Point)` live location; compliance docs (insurance/rc/puc/permit) hang off trucks with expiry tracking; `fleet_driver_shares` fixes the driver/fleet split (CHECK: shares sum to 100). |
| Drivers | `drivers`, `driver_documents` | KYC status, level, online flag, `geography(Point)` location, optional `fleet_id`, `assigned_truck_id` (0004). |
| Bookings & dispatch | `bookings`, `booking_status_history`, `booking_location_path`, `dispatch_attempts` | `bookings` holds the full fare breakdown + commission columns; `booking_status_history` is the append-only status trail; `dispatch_attempts` records each offer wave (wave, radius_km, outcome). |
| Zones | `service_zones` | `geography(Polygon)` areas with surge band, highway flag, `dispatch_config` jsonb. |
| Money | `wallets`, `wallet_transactions`, `payments`, `payouts`, `refunds` | **Ledger-first rule:** `wallet_transactions` is the signed, append-only ledger (idempotency-keyed, amount ≠ 0); `wallets.balance` is a projection that must equal `SUM(wallet_transactions.amount)` per wallet. Payments/payouts carry unique idempotency keys; all amounts CHECK-constrained positive. |
| Auth | `fleet_owner_credentials`, `login_challenges`, `otp_verifications`, `refresh_tokens` | Password + lockout for the fleet console; hashed OTPs with attempts/expiry; rotating refresh-token families (`family_id`, `token_hash` unique, revocation columns). |

```mermaid
erDiagram
    users ||--o{ addresses : has
    users ||--o{ saved_vehicles : has
    users ||--o{ bookings : requests
    users ||--|| fleet_owner_credentials : "console login"
    users ||--o{ fleets : owns
    fleets ||--o{ fleet_trucks : operates
    fleets ||--o{ drivers : employs
    fleets ||--o{ fleet_driver_shares : "split config"
    fleet_trucks ||--o{ compliance_documents : "insurance/rc/puc/permit"
    fleet_trucks |o--o| drivers : "assigned_truck_id (unique)"
    drivers ||--o{ driver_documents : kyc
    drivers ||--o{ bookings : fulfils
    service_zones ||--o{ bookings : "zone_id"
    bookings ||--o{ booking_status_history : trail
    bookings ||--o{ dispatch_attempts : "offer waves"
    bookings ||--o{ payments : paid_by
    bookings ||--o{ refunds : refunded_by
    wallets ||--o{ wallet_transactions : "ledger (balance = SUM)"
```

## 6. Notable indexes & database-enforced invariants

| Kind | Name | Detail |
|---|---|---|
| GIST | `idx_drivers_geo`, `idx_fleet_trucks_geo`, `idx_service_zones_geo` | Spatial search; without them dispatch degrades to sequential scans. |
| Feed pagination | `idx_bookings_fleet_feed` | `bookings (fleet_id, created_at DESC NULLS LAST, id DESC NULLS LAST)` — keyset pagination for the console booking feed. |
| Partial unique | `uq_drivers_assigned_truck` | One driver per truck; NULL (unassigned) rows excluded; makes concurrent truck assignment race-safe (23505). |
| Unique | `uq_fleet_trucks_fleet_plate` | Plate unique *within* a fleet, not globally. |
| Partial | `idx_compliance_documents_active_expiry` | `expires_at` where `status <> 'expired' AND expires_at IS NOT NULL`. |
| CHECK | `ck_fleet_driver_shares_sum_100` | `driver_share + fleet_share = 100`. |
| CHECK | `ck_bookings_commission_pct_guardrail` | `commission_pct` NULL or between 5 and 10. |
| CHECK | `ck_bookings_non_negative`, `ck_bookings_payout_within_total` | Fare amounts ≥ 0; `commission_amount + driver_payout <= total`. |
| CHECK | `ck_payments_amount_positive`, `ck_payouts_amount_positive`, `ck_refunds_amount_positive`, `ck_wallet_transactions_amount_nonzero` | Money rows can never be zero/negative (ledger sign carries credit vs debit). |
| Unique | `uq_payments_idempotency_key`, `uq_payouts_idempotency_key`, `uq_wallet_transactions_idempotency_key` | Idempotent money writes (Phase 7 will lean on these). |

These live in the database on purpose: they must hold even if application code is wrong.

## 7. Connections & pooling

From `apps/backend/src/db/db.module.ts` and `src/config/env.ts`:

- Driver is **postgres.js**, configured with `prepare: false` — no server-side prepared statements. This is **RDS-Proxy-friendly**: prepared statements are the usual session-pinning trigger in transaction-pooling proxies, and this app doesn't use them (Drizzle builds its own SQL).
- Pool size: `max: DATABASE_POOL_MAX`, env-validated positive integer, **default 10** per backend process. Size RDS `max_connections` (or the proxy pool) as `instances × DATABASE_POOL_MAX` plus headroom for the migration task (1) and any one-off tasks.
- `DATABASE_URL` must be a `postgres://` or `postgresql://` URL (zod-validated at boot). Local format for reference: `postgres://towfleet:towfleet@localhost:5432/towfleet`.
- Graceful shutdown: the Nest module closes the pool with `sql.end({ timeout: 5 })` on application shutdown.
- **No TLS options are passed in code.** Connecting to an RDS instance with `rds.force_ssl` enabled will require an `sslmode`/`ssl` parameter on `DATABASE_URL` (postgres.js reads it from the URL) — see the decisions list.

## 8. Seed (demo data — non-production only)

`pnpm --filter @towing/backend db:seed` runs `src/db/seed/index.ts` (a thin CLI over the exported `runSeed`, which the vitest suite also uses).

- **Hard refusal:** throws immediately if `NODE_ENV=production`.
- **Idempotent:** if fleets already exist it exits with "Database already seeded"; `pnpm db:reset` (`--reset`) first truncates the 24 app-owned tables (`TRUNCATE ... CASCADE`, explicit list in `seed.ts` — never PostGIS or drizzle objects) and reseeds.
- **What it creates** (deterministic, fixed RNG seed): two demo fleets — *Lakshmi Recovery Services* and *Chennai Highway Rescue* — with console owner logins (e.g. `lakshmi@recovery.in`, password `Password123!` for both, printed at the end of the run), trucks with compliance documents, fleet drivers plus one independent driver, demo customers, ~500 bookings (260 + 210 per fleet + 30 independent) spanning 90 days with status history, payments, wallets, a signed ledger, and payouts (including one deliberately failed payout to exercise the console alert feed).
- **Money invariants verified at exit** (`verifySeedInvariants`; any non-zero count fails the run):
  1. every `wallets.balance` equals `SUM(wallet_transactions.amount)` for that wallet;
  2. every `paid` booking satisfies `commission_amount + driver_payout = total`;
  3. every `paid` booking's share-credit ledger rows (`driver_share_credit`/`fleet_share_credit`/`fare_credit` by `ref_id`) sum to `driver_payout`.
- **On AWS:** run as a one-off ECS task with the backend image and command `pnpm --filter @towing/backend db:seed` — only in dev/staging environments where `NODE_ENV` is not `production` (same `tsx`-devDependency caveat as migrations, §3). The dev OTP adapter that prints OTPs to the log is likewise dev-only; neither belongs anywhere near production data.

## 9. Reference artifacts in `Aws/`

| Artifact | What it is |
|---|---|
| `Aws/migrations/` (+ `meta/`) | Point-in-time **copy** of the migration set through idx 44 (`0044_booking_in_transit_at`), refreshed 24 Sep 2026. **Canonical source is `apps/backend/drizzle/`** — always deploy from there; treat this copy as review material that may lag. |
| `Aws/db/schema-snapshot.sql` | Schema-only `pg_dump` (server/pg_dump 16.4) taken **05 Aug 2026** after migrations 0000–0005. Useful to review the final DDL without running anything. It also captures PostGIS-owned artifacts the dev image installed (`tiger`/`tiger_data`/`topology` schemas; `fuzzystrmatch`, `postgis_tiger_geocoder`, `postgis_topology` extensions) — the app owns only the 32 `public`-schema tables plus `drizzle.__drizzle_migrations`. **Do not restore this dump to provision**; provision by running the migrations. |

**Refreshing these artifacts.** Whenever a migration merges: copy `apps/backend/drizzle/` (including `meta/`) over `Aws/migrations/`; regenerate `Aws/db/schema-snapshot.sql` against **any** local dev database that is fully migrated, with `docker exec <container> pg_dump -U towfleet -d towfleet --schema-only --no-owner --no-privileges` (the repo's own compose project is named `towfleet`, so its container is `towfleet-postgres-1`; a hand-started one will be called something else — check `docker ps` and confirm `select count(*) from drizzle.__drizzle_migrations` equals the journal entry count before dumping); update the dated lines wherever they appear in this pack; and bump the expected journal count in the runbook verification checklist ([06 §3](06-operations-runbook.md), check 3) — all in the **same commit**, so the snapshots never silently lag the canonical set.

## 10. Decisions needed from the AWS engineer

Genuinely undecided — nothing in the repo pins these:

1. **Region, instance class, storage, Multi-AZ** for RDS (and whether Aurora PostgreSQL is preferred over RDS for PostgreSQL — the app only assumes "PostgreSQL 16 + PostGIS").
2. **RDS Proxy: yes/no.** Code is compatible (`prepare: false`); needed mainly if backend instance count × pool 10 threatens `max_connections`.
3. **TLS enforcement**: `rds.force_ssl` + the `sslmode`/`ssl` URL parameter and CA-bundle handling for postgres.js (nothing configured in code today).
4. **Migration execution mechanism**: one-off ECS task vs. CI/CD step, and how to get `tsx` + the `drizzle/` folder into that image (dev deps in the runtime image, a dedicated migration image, or precompiling the runner).
5. **App database user strategy**: run app + migrations as one role, or a lesser app role with a privileged migration role (migration 0000 needs extension-create rights once per database).
6. **Backups**: PITR/snapshot retention, and any cross-region copy requirement — the full decision set (RPO/RTO per environment, retention days, cross-region copies, Redis loss window) lives in [06 "Backup & DR"](06-operations-runbook.md).
7. **Minor-version and PostGIS-version pinning** on RDS (dev is 16.x / PostGIS 3.4; snapshot was 16.4).

> Decisions in this list are ratified by the owners listed in [01 "Owners & contacts"](01-project-overview.md) — all currently TBD.

_Last updated: 03 Aug 2026 · Sources: Aws/migrations/0000_enable_postgis.sql, 0001_core_schema.sql, 0002_spatial_and_constraints.sql, 0003_fleet_credentials.sql, 0004_petite_richard_fisk.sql, Aws/migrations/meta/_journal.json, Aws/db/schema-snapshot.sql, apps/backend/src/db/migrate.ts, apps/backend/src/db/db.module.ts, apps/backend/src/db/seed/index.ts, apps/backend/src/db/seed/seed.ts, apps/backend/src/db/seed/fixtures.ts, apps/backend/src/config/env.ts, apps/backend/drizzle.config.ts, apps/backend/docker-compose.yml, apps/backend/package.json, apps/backend/.env.example_
