# 04 — Runtime Environment: Processes, Configuration, Packaging

Audience: the AWS engineer deploying the Towing platform (Phase 9 — now split into **9a staging**, which is next, and 9b production — of `docs/TowFleet-Implementation-Plan-V2.md`; Track A phases 1–8 and Track B phases 10–12 are complete). This document inventories every process that must run, every environment variable each process reads, and the current state of packaging. Where something is genuinely undecided it is listed under [Decisions needed](#decisions-needed-from-the-aws-engineer) rather than guessed.

---

## 1. Process inventory

```mermaid
flowchart LR
    subgraph web["towfleet-web :3000"]
        BFF["Next.js BFF proxy<br/>/api/proxy/[...path]"]
    end
    subgraph api["backend API :4000"]
        NEST["NestJS 11<br/>prefix /v1"]
    end
    PG[("PostgreSQL 16 + PostGIS")]
    RD[("Redis 7")]
    BFF -->|"Authorization injected,<br/>refresh handled server-side"| NEST
    NEST --> PG
    NEST --> RD
    MIG["one-off: db:migrate"] --> PG
    SEED["one-off: db:seed<br/>(non-prod only)"] --> PG
    SIM["dev-only: sim:locations"] --> RD
    SIM -.->|lazy flush| PG
```

### Long-running services

| Process | Workspace | Start command | Port | Health check | Notes |
|---|---|---|---|---|---|
| Backend API | `apps/backend` | prod: `node dist/main.js` (after `nest build`) · dev: `pnpm dev` | `PORT` env, default **4000** | `GET /v1/health` → `{ status: "ok", service: "towing-backend", time }` | Global route prefix `/v1`; CORS origins from `CORS_ORIGINS`; graceful shutdown enabled (§6) |
| Fleet web console | `apps/towfleet-web` | prod: `next start -p 3000` (after `next build`) · dev: `next dev -p 3000` | **3000** (hard-coded `-p 3000` in package scripts) | none defined yet | Next.js 15 App Router. Session cookies only in browser; BFF proxy talks to backend server-side |

### One-off / operational processes (run in `apps/backend`)

| Command | Script | What it does | Production notes |
|---|---|---|---|
| `pnpm db:migrate` | `tsx src/db/migrate.ts` | Applies pending Drizzle SQL migrations from `apps/backend/drizzle/` on a single connection (`max: 1`), journaled in table `drizzle.__drizzle_migrations`, then exits (exit 1 on failure) | Runs via `tsx`, a **devDependency** — see §4 packaging gap |
| `pnpm db:seed` | `tsx src/db/seed/index.ts` | Deterministic demo data; three money invariants asserted at exit; demo login `lakshmi@recovery.in` / `Password123!` | **Refuses to run** with `NODE_ENV=production` (throws) — never wire into a prod pipeline |
| `pnpm db:reset` | `tsx src/db/seed/index.ts --reset` | Seed with reset flag | Same production refusal |
| `pnpm sim:locations` | `tsx src/scripts/simulate-locations.ts` | Fake truck GPS → Redis pub/sub (`LOCATION_CHANNEL`) + GEO, lazy Postgres flush; stands in for the driver mobile app | Dev/demo only — not a deployable service |

### Future processes (not yet built — plan for them in the architecture)

| Process | Phase | Notes |
|---|---|---|
| Realtime gateway | Phase 5 — **landed** | Socket.io `/fleet` namespace inside the same `AppModule` and the same image as the API (`node dist/main.js` serves both). Needs Redis reachable and ALB idle timeout ≥ 75 s; **no handshake stickiness** (`transports: ['websocket']`). Splitting it into its own ECS service is a scaling decision, not a code change |
| Queue workers | Phase 6 — **landed** | BullMQ on ElastiCache, **inside the API task today**: `ComplianceService` and `TruckImportsService` register their workers in `onModuleInit`, so every task is both API and worker. Splitting them out is `QUEUE_ENABLED=false` on the API service plus a worker service running the same image — no code change. Needs Redis reachable; no inbound port. Depth/DLQ at `GET /v1/health/queues` |
| Earnings projector | Phase 7 — **landed** | `earnings.project` recomputes one `(fleet, IST day, driver)` cell of `earnings_daily` after every settlement commit. Absolute recompute, never a delta, so BullMQ's at-least-once delivery is harmless. Same task, same image, same `QUEUE_ENABLED` switch |
| Nightly ledger reconciliation | Phase 7 — **landed** | `earnings.reconcile` at `LEDGER_RECONCILE_CRON` (01:00 IST): the three §14 money invariants, the projection audit (drifted cells are re-enqueued, so it self-heals), and a payout-alert reconcile. **Throws on drift**, which raises `deadLettered` on `GET /v1/health/queues` — reuse that alarm rather than adding one. Live status at `GET /v1/health/ledger` |
| Payout reconciliation poll | Phase 7 — **landed** | `payouts.reconcile` at `PAYOUT_RECONCILE_CRON` (every 5 min), the §19.3 missed-webhook sweep. Single-owner via the same Redis schedule dedup. Bounded to 200 payouts per tick, so a backlog cannot become thousands of vendor calls |

Mobile apps (`apps/towgo`, `apps/towpartner`) are Expo/React Native: nothing to deploy for them, but since Phase 12 they **are** clients of the backend you deploy (phone-OTP auth, the customer `/v1/me/*` group, driver KYC uploads). They need a reachable HTTPS origin — that is one of the reasons Phase 9a (staging) exists — and CORS/`CORS_ORIGINS` planning should account for native clients, which send no `Origin` header on same-origin-less native fetches.

---

## 2. Backend environment variables — complete reference

Source of truth: `apps/backend/src/config/env.ts` (Zod schema, parsed once at boot; any invalid or missing value **crashes the process** with a readable report). Sample values: `apps/backend/.env.example`.

| Variable | Type | Default | Required in prod? | Notes |
|---|---|---|---|---|
| `NODE_ENV` | `development \| test \| production` | `development` | Yes — set `production` | Controls log transport (§5), seed refusal, and `assertProductionSafety` |
| `PORT` | positive int | `4000` | Optional | HTTP listen port |
| `LOG_LEVEL` | `fatal \| error \| warn \| info \| debug \| trace` | `info` | Optional | pino level |
| `DATABASE_URL` | URL, protocol `postgres`/`postgresql` | **none — required** | **Yes** | e.g. `postgres://user:pass@host:5432/db` |
| `DATABASE_POOL_MAX` | positive int | `10` | Optional | pg pool size per process — multiply by instance count when sizing RDS `max_connections` |
| `DATABASE_READ_URL` | URL, protocol `postgres`/`postgresql` | **unset** | Optional | **RDS read-replica seam (Phase 7).** UNSET IS THE NORMAL CASE and is not degraded: `DB_READER` then resolves to the *same pool object* as `DB`, so there is no second connection and no doubled `max_connections` maths. Set it to a replica endpoint when report/earnings load justifies it — a Phase 9b capacity decision. The services that must never write (earnings, reports, statements, the jobs feed, alerts, dashboard compute) already take the reader, enforced by `sole-writer.spec.ts` |
| `DATABASE_READ_POOL_MAX` | positive int | `10` | Optional | Pool size for the reader — ignored entirely while `DATABASE_READ_URL` is unset |
| `REDIS_URL` | URL, protocol `redis`/`rediss` | **none — required** | **Yes** | `rediss://` accepted for TLS (ElastiCache in-transit encryption) |
| `JWT_ACCESS_SECRET` | string, **min 32 chars** | **none — required** | **Yes** | `assertProductionSafety` throws at boot if `NODE_ENV=production` and the value contains `dev-only` (the checked-in `.env.example` placeholder). Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_ACCESS_TTL_SECONDS` | positive int | `900` (15 min) | Optional | Access-token lifetime |
| `JWT_REFRESH_TTL_SECONDS` | positive int | `2592000` (30 d) | Optional | Refresh-token lifetime (rotating, stored hashed) |
| `OTP_TTL_SECONDS` | positive int | `300` | Optional | OTP validity window |
| `OTP_MAX_ATTEMPTS` | positive int | `5` | Optional | OTP verify attempts |
| `UPLOADS_DIR` | string (path) | `var/uploads` | Interim only | Root for the **disk** storage adapter. Only matters until the S3 adapter lands (Phase 7/9); until then the API writes uploads to local disk — see §7 |
| `THROTTLE_DISABLED` | `'1'`/`'true'` → boolean | `''` (false) | **Must NEVER be set in prod** | Test-suite escape hatch that disables all rate limiting. Note: `throttler.config.ts` reads it from `process.env` directly at module-definition time, so it takes effect at boot only |
| `CORS_ORIGINS` | comma-separated string → string[] | `http://localhost:3000` | **Yes** | Set to the deployed web console origin(s); backend runs `enableCors({ credentials: true })`. **Also gates WebSocket handshakes** — the gateway's `allowRequest` checks `Origin` against this list, because a WS upgrade is not subject to browser CORS |
| `PUBLIC_WS_URL` | URL | `http://localhost:4000` | **Yes** | Origin the browser opens the WebSocket against. Handed to the client in the ticket response rather than baked into the web bundle, so relocating the gateway needs no web rebuild — but a wrong value points every console at the wrong host |
| `REALTIME_ENABLED` | `'false'`/`'0'` → false | `true` | Optional | §19.2 kill switch. Off ⇒ ticket endpoint returns `503 realtime_unavailable`, relays are not installed, and the console falls back to 10 s REST polling against `GET /v1/fleet/realtime/positions`. Useful to shed load or isolate a gateway incident without a deploy |
| `REALTIME_FLUSH_MS` | integer ms | `1000` | Optional | Location batch cadence. Lower = fresher and more socket frames; the §19.1 budget is 2 s p95 end-to-end, and this interval is most of the floor |
| `REALTIME_TICKET_TTL_SECONDS` | integer s | `60` | Optional | Outer bound on a handshake ticket; they are single-use regardless |
| `REALTIME_METRICS_DEBOUNCE_MS` | integer ms | `2000` | Optional | Coalesces a burst of domain events into one KPI recompute per fleet. Doubles as the TTL of the per-fleet recompute lock |
| `QUEUE_ENABLED` | `'false'`/`'0'` → false | `true` | Optional | Off ⇒ nothing is enqueued, no BullMQ workers start, and no cron is registered. The API stays fully functional; background work is **deferred, not lost** (the compliance sweep is idempotent and catches up). This is the switch that lets a task be deployed API-only if the gateway/worker split in Decision 5 goes that way |
| `QUEUE_CONCURRENCY` | integer | `4` | Optional | Jobs processed in parallel **per worker per task**. Effective concurrency is this × task count |
| `COMPLIANCE_SWEEP_CRON` | cron | `0 * * * *` | Optional | Hourly on the hour (§9.3.4). BullMQ deduplicates the schedule in Redis, so every task registering it still yields ONE timer — do not try to pin this to a single task |
| `BULK_IMPORT_SYNC_MAX_ROWS` | integer | `500` | Optional | Above this an import is queued instead of committed in the request (§9.3.4). Lower it if the ALB idle timeout ever becomes the binding constraint |
| `BULK_IMPORT_MAX_ROWS` | integer | `10000` | Optional | Hard ceiling on one import, whichever path it takes |
| `LEDGER_RECONCILE_CRON` | cron | `30 19 * * *` | Optional | §14.1's nightly reconciliation = 01:00 IST: after the IST day boundary so "yesterday" is closed, in the roadside-demand trough. Same Redis schedule dedup as the compliance sweep — every task registers it, one timer results |
| `LEDGER_DRIFT_TOLERANCE_PAISE` | int ≥ 0 | `0` | Optional | **Keep at 0.** The money invariants are exact by construction (NUMERIC, no floats), so any non-zero delta is a bug and never noise. The knob exists so an incident can be triaged — swallowing a known, ticketed delta while a fix ships — without a redeploy |
| `LEDGER_OPS_EMAIL` | string | `ops@towing.local` | **Yes** | Where the drift alarm mails. The job **also throws** on drift, so BullMQ records a failure and `deadLettered` rises on `GET /v1/health/queues` — that is the alarm to wire, the email is the courtesy |
| `PAYOUT_PROVIDER` | `dev \| razorpay_route` | `dev` | **Yes — must be `razorpay_route`** | `assertProductionSafety` **refuses to boot** production on `dev`: the dev adapter marks payouts `paid` on a timer with no bank involved, which in production is a ledger full of money nobody sent. `dev` is nonetheless the permanent LOCAL path — same standing as `DevOtpAdapter` and the disk `StoragePort` |
| `PAYOUT_MIN_PAISE` | positive int | `100000` (₹1,000) | Optional | §14.4's "min threshold". Route/IMPS fees are ₹2–5 per transfer, so below ~₹1,000 the fee is a material share. Returned by `GET /v1/fleet/earnings`, so the console's disabled state is server-driven and cannot drift from this check |
| `PAYOUT_MAX_PAISE` | positive int | `50000000` (₹5,00,000) | Optional | Per-request sanity cap — a units-bug guard so a client sending rupees where paise are expected cannot request 100× the intent. Not a product rule |
| `PAYOUT_RECONCILE_CRON` | cron | `*/5 * * * *` | Optional | §19.3's missed-webhook sweep. This is what makes "a timeout is not a failure" safe: an un-acknowledged payout stays `requested` and this asks the provider what actually happened |
| `PAYOUT_STUCK_MINUTES` | positive int | `15` | Optional | A payout still `requested` with no provider reference after this long never reached the provider; it is failed, which returns the money to the wallet |
| `PAYOUT_DEV_SETTLE_MS` | positive int | `5000` | Dev only | How long the dev adapter waits before settling to `paid`. Irrelevant in production (see `PAYOUT_PROVIDER`) |
| `PAYOUT_WEBHOOK_SECRET` | string, **min 16 chars** | `dev-only-…` placeholder | **Yes** | HMAC-SHA256 key for `POST /v1/webhooks/razorpay`. `assertProductionSafety` throws if it still contains `dev-only`. The **dev adapter verifies with the same algorithm and secret**, which is what keeps the signature path exercised on every local and CI run rather than only once real credentials exist |
| `PAYMENT_GATEWAY` | `dev \| razorpay` | `dev` | **Yes — must be `razorpay`** | §14.2's money-IN switch, SEPARATE from `PAYOUT_PROVIDER` on purpose: Razorpay's payment gateway and RazorpayX Route are different products with independent availability, and one switch for both would mean a payouts outage configuring customers out of paying. `assertProductionSafety` refuses `dev` for the same reason it refuses the dev payout adapter — a gateway that reports every payment captured with no bank involved credits drivers from money nobody sent, and every ledger invariant stays green while it happens |
| `PAYMENT_WEBHOOK_SECRET` | string, **min 16 chars** | `dev-only-…` placeholder | **Yes** | HMAC key for the PAYMENT half of `POST /v1/webhooks/razorpay`. Distinct from `PAYOUT_WEBHOOK_SECRET` because the two products are configured in separate dashboards; the controller verifies against **both** and routes by whichever matched, so sharing one secret also works. `assertProductionSafety` throws on the `dev-only` placeholder |
| `PAYMENT_DEV_SETTLE_MS` | int ≥ 0 | **`0`** | Dev only | How long the dev gateway waits before reporting `captured`. **Zero, unlike `PAYOUT_DEV_SETTLE_MS`'s 5000**, and the asymmetry is honest: a bank transfer is asynchronous by nature, a UPI capture is synchronous from the app's point of view. Zero also means the whole chain runs with NO QUEUE, which is what `QUEUE_ENABLED=false` (the entire test suite) needs. Raise it locally to see §19.2's `COMPLETED (unpaid)` state |
| `PAYMENT_RECONCILE_CRON` | cron | `*/5 * * * *` | No | §19.3's payment status sweep. A BullMQ repeatable, not a cron job — `QueuePort.schedule` keys the timer in Redis so N Fargate tasks converge on one, which is the double-capture this must never rely on the idempotency ladder to catch |
| `PAYMENT_STUCK_MINUTES` | positive int | `30` | No | A payment the gateway never confirms after this long is marked `failed` and **the booking stays `completed`** (§19.2). Longer than the payout equivalent's 15 because a customer can legitimately leave a UPI collect request pending in their bank app |
| `EARNINGS_WEEKLY_CRON` | cron | `30 3 * * 1` | No | §12.2's weekly earnings digest — Monday 03:30 UTC = 09:00 IST, so it lands in a driver's morning rather than overnight. ⚠ The container's timezone has not been verified against this assumption over a real week |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | string | unset | **Yes** | **One merchant, one credential pair, two adapters** — Route (money out) and the payment gateway (money in) share these; Phase 19 added no new credential vars. Validated in each adapter's `onModuleInit`, **never in a constructor** — Nest instantiates every adapter regardless of which the factory selects, so a throwing constructor would break the dev path for everyone. `RazorpayPaymentsAdapter` also uses `RAZORPAY_KEY_SECRET` (**not** `PAYMENT_WEBHOOK_SECRET`) to verify the checkout signature — a different key for a different handshake, and confusing the two is the classic Razorpay bug |
| `RAZORPAY_BASE_URL` | URL | `https://api.razorpay.com` | Optional | Override for a sandbox or a recorded-fixture host |
| `RAZORPAY_TIMEOUT_MS` | positive int | `5000` | Optional | §19.3's 2–5 s external-call budget, enforced with `AbortSignal.timeout`. A vendor call that hangs is what turns a slow provider into pool exhaustion |

### Phase 18 — job execution, live tracking & share trip

| Variable | Type | Default | Required in prod | Notes |
|---|---|---|---|---|
| `DIRECTIONS_PROVIDER` | `haversine \| google_directions` | `haversine` | Optional | §11.4/§11.5 route lines and ETAs. A **third** Maps switch alongside `ROUTING_PROVIDER` and `GEOCODING_PROVIDER`, because Directions is enabled and billed independently of Distance Matrix in Google Cloud — "routes on, fare distances off" is a real configuration. `haversine` is a first-class §19.2 path, not a stub, and is what the breaker falls back to |
| `GOOGLE_DIRECTIONS_URL` | URL | `…/maps/api/directions/json` | Optional | Override for a sandbox or a recorded-fixture host |
| `DIRECTIONS_TIMEOUT_MS` | positive int | `4000` | Optional | §19.3's full 2–5 s band — deliberately **looser** than `ROUTING_TIMEOUT_MS`'s 1.5 s. Distance Matrix sits inside §7.6's 2-second estimate guarantee with a customer waiting on a price; this runs once at assignment on a screen that works without it, so patience is cheap and a slow route beats a straight line for the whole trip |
| `DIRECTIONS_ENABLED` | `'false'`/`'0'` → false | `true` | Optional | **§19.8 kill switch for the only thing here billed per call on an account with no hard spend cap** (SETUP-CHECKLIST item 7 — both cap routes were checked and both are closed for Maps). Off ⇒ every trip still gets a route line and an ETA; they are straight and labelled `haversine`. This is the lever for "the Maps bill is running away" at two in the morning, without a deploy |
| `HAVERSINE_ROUTE_FACTOR` | positive number | `1.3` | Optional | Great-circle → road correction for the fallback ETA. Mirrors §7.4's `charge_config.haversine_road_factor`, which stays a pricing knob. Measured over seven real Bengaluru/Chennai routes: mean 1.307, median 1.304 |
| `FALLBACK_SPEED_KPH` | positive number | `22` | Optional | Assumed speed for the straight-line ETA. Deliberately pessimistic: §11.5's whole purpose is that the number does not lurch upward later, and an ETA that improves beats one that slips |
| `PUBLIC_TRACK_BASE_URL` | URL | `http://localhost:3000` | **Yes** | Public origin of §11.7's share page. The `/t/{token}` URL is composed **server-side** and returned whole — relocating the page must not need a mobile release. `assertProductionSafety` **refuses to boot** on a `localhost` value: a production build shipping `http://localhost:3000/t/…` produces a link that is not merely broken but confusing, and it is unrecoverable once somebody has sent it over WhatsApp |
| `SHARE_LINK_GRACE_MINUTES` | positive int | `30` | Optional | §11.7's "+30 min grace" after completion. A knob rather than a constant because the grace exists for a human following the link who wants to see it ended well |
| `TELEPHONY_PROVIDER` | `direct \| exotel` | `direct` | **Yes — must be `exotel`** | §9.1.7/§9.2.3's masked calling. `assertProductionSafety` **refuses to boot** production on `direct`, and the reason is worth distinguishing from the Maps switches: `haversine` is a worse answer to the same question and costs only accuracy, while `direct` answers a DIFFERENT question — it discloses a personal phone number, permanently and irreversibly, to somebody who was never meant to have it (§20.4). Honest for development, refused in production. **No provider account exists yet — SETUP-CHECKLIST item 13** |
| `EXOTEL_SID` / `EXOTEL_TOKEN` | string | unset | **Yes** (with `exotel`) | Validated in `ExotelAdapter.onModuleInit`, never in its constructor — both adapters are instantiated whichever the factory selects |
| `EXOTEL_CALLER_ID` | string | unset | **Yes** (with `exotel`) | The DID both handsets dial and see. Account configuration, not a per-call value |
| `EXOTEL_BASE_URL` | URL | `https://api.exotel.com/v1/Accounts` | Optional | — |
| `EXOTEL_TIMEOUT_MS` | positive int | `4000` | Optional | §19.3's band |

**Phase 18 deploy note.** `GET /v1/track/:shareToken` is the **only unauthenticated read of a booking** in the system and must be publicly reachable — like the Razorpay webhook, it needs an ALB listener rule that does not sit behind any auth. Unlike the webhook it is **not** `@SkipThrottling()`: the webhook's HMAC rejects an unsigned request before any database work, and a share token has no such gate, so the `realtime` bucket is what keeps a link forwarded into a group chat from becoming a load generator. The web app's `/t/{token}` page and its `/api/track/{token}` proxy must also be reachable without a `fleet_session` cookie — `middleware.ts` is deny-by-default and carries an explicit `PUBLIC_PREFIXES` branch for exactly this.

Dev OTPs are printed to the backend log by `DevOtpAdapter` — development only, never in production.

**Phase 7 deploy note.** `POST /v1/webhooks/razorpay` must be **publicly reachable** — it carries no session and is authenticated by its HMAC signature alone, so it needs an ALB listener rule that does not sit behind any auth. Phase 9a already anticipates this ("a real HTTPS origin so … Razorpay webhooks … have somewhere to point").

---

## 3. Web console (towfleet-web) environment variables

Source: `apps/towfleet-web/src/lib/env.ts` + `apps/towfleet-web/.env.example`.

Two distinct binding times — this is the single most common deploy mistake to avoid:

| Variable | Binding time | Default | Production requirement |
|---|---|---|---|
| `NEXT_PUBLIC_USE_MOCKS` | **BUILD time** — statically inlined into the bundle by `next build` | `true` (mocks ON unless the value is exactly the string `false`) | **Production images MUST be built with `NEXT_PUBLIC_USE_MOCKS=false` present in the build environment.** Setting it at container runtime has no effect |
| `API_BASE_URL` | **Runtime, server-side only** | `http://localhost:4000` | Set in the task/container environment to the backend's internal URL (e.g. internal ALB / service-discovery DNS). Never exposed to the browser |
| `NEXT_PUBLIC_MOCK_DASHBOARD_STATE` | Build time | `''` | Dev-only (`'' \| 'empty' \| 'error'` — forces feedback-state previews). Leave unset in prod builds |
| `NEXT_PUBLIC_MOCK_TRUCKS_STATE` | Build time | `''` | Same |
| `NEXT_PUBLIC_MOCK_DRIVERS_STATE` | Build time | `''` | Same |
| `NEXT_PUBLIC_MOCK_JOBS_STATE` | Build time | `''` | Same |
| `NEXT_PUBLIC_MOCK_EARNINGS_STATE` | Build time | `''` | Same |

Session model (context for why `API_BASE_URL` is server-side): the browser holds only httpOnly cookies (`fleet_session` = 15-min JWT, `fleet_refresh` = rotating 30-day token). The Next.js BFF proxy at `src/app/api/proxy/[...path]/route.ts` injects `Authorization` and transparently refreshes — see the multi-instance caveat in §7.

---

## 4. Packaging

### Current state — nothing is deployable yet

`apps/backend/Dockerfile` is a **placeholder stub** (verified, 03 Aug 2026 — its entire content):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
CMD [ "node", "-v" ]
```

It does not install dependencies, build, or start the server. `apps/towfleet-web` has **no Dockerfile at all**, and `apps/towfleet-web/next.config.ts` does **not** set `output: 'standalone'` (it only sets `transpilePackages` for the raw-TS workspace packages `@towing/theme`, `@towing/web-ui`, `@towing/api-contracts`).

### What Phase 9 must produce

| Image | Build | Run command | Open items |
|---|---|---|---|
| Backend API | Multi-stage pnpm workspace build: install → `nest build` → prune to prod deps | `node dist/main.js` | **Migration runner decision** (below); copy `apps/backend/drizzle/` into the image if migrations run from it |
| towfleet-web | `next build` with `NEXT_PUBLIC_USE_MOCKS=false` in the build env; enable `output: 'standalone'` in `next.config.ts` for a minimal runtime image (config change — currently absent) | `node server.js` (standalone) or `next start -p 3000` | Standalone output must be added deliberately; `transpilePackages` must be preserved |

**Migration-runner gap (Phase 9 decision):** `pnpm db:migrate` executes `tsx src/db/migrate.ts`, and `tsx` is a **devDependency**. A pruned production image cannot run it as-is. Options:

1. Ship `tsx` (and `src/`) in the production image — larger image, but zero code change; or
2. Compile the migrator: `nest build` emits `dist/db/migrate.js`; run `node dist/db/migrate.js`. Note `migrate.ts` resolves the migrations folder as `resolve(__dirname, '../../drizzle')`, which from `dist/db/` lands on `apps/backend/drizzle/` — so the SQL folder must be copied into the image adjacent to `dist/` either way; or
3. A dedicated migration image/one-off ECS task with dev deps installed.

Either way, migrations should run as a **one-off task before rollout** (single connection, serial DDL), not inside every API container's entrypoint.

### Migration sources — canonical vs snapshot

| Location | Status |
|---|---|
| `apps/backend/drizzle/` (`0000_enable_postgis` → `0004_petite_richard_fisk` + `meta/`) | **CANONICAL** — what `db:migrate` applies; journal table `drizzle.__drizzle_migrations` |
| `Aws/migrations/` | Point-in-time **copy** for reference only — do not apply from here |
| `Aws/db/schema-snapshot.sql` | `pg_dump` schema snapshot dated 03 Aug 2026 — reference for reviewing the target schema, not a deploy artifact |

---

## 5. Logging

Implemented in `apps/backend/src/common/logging/logger.module.ts` (nestjs-pino) and `request-id.middleware.ts`.

| Aspect | Behavior |
|---|---|
| Format, production | Raw **NDJSON to stdout** (no transport) — point the log driver (awslogs/FireLens) at container stdout |
| Format, development | `pino-pretty` (single-line, local time) — pino-pretty is a devDependency and is never loaded when `NODE_ENV=production` |
| Level | `LOG_LEVEL` env (default `info`) |
| Credential redaction | pino `redact` before serialization, censor `[redacted]`. Paths: `req.headers.authorization`, `req.headers.cookie`, `req.headers["proxy-authorization"]`, `req.headers["x-api-key"]`, `res.headers["set-cookie"]`, and `password`, `otp`, `token` plus one-level-nested `*.password`, `*.otp`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.authorization`, `*.cookie`, `*.secret` |
| Request correlation | Header **`x-request-id`**: an inbound value is accepted only if it matches `^[A-Za-z0-9._:-]{8,128}$` (log-injection guard), otherwise a fresh UUID is minted. The same id appears in the access log, all app log lines, and the response header — an ALB-generated trace id passed through in this header will correlate end-to-end |
| Health-probe noise | Access-logging skips any URL starting with `/v1/health`, so LB probes do not dominate log volume |
| Boot logs | `bufferLogs: true` — module-init and env-failure lines flush through pino once ready (still structured) |

---

## 6. Graceful shutdown

`src/main.ts` calls `app.enableShutdownHooks()`. On SIGTERM the Nest lifecycle closes the pg pool and Redis connections and the process exits cleanly — deliberately ECS-friendly: task drain completes without waiting for the 30 s SIGKILL. Keep the ECS `stopTimeout` at or above the default 30 s; no special entrypoint signal handling is needed as long as `node` is PID 1 or signals are forwarded.

---

## 7. Scaling and statefulness caveats

The API is stateless (JWT access tokens; refresh tokens stored hashed in Postgres; no server-side session store) **except** for the items below:

| Component | State | Impact of N instances | Remediation |
|---|---|---|---|
| API rate limiter (`@nestjs/throttler`) | **In-memory, per process** (`throttler.config.ts` documents this as a deliberate "storage seam") | Effective limits become N × configured (reads 120/min, money 20/min, auth/OTP **5/min** — the OTP brute-force protection weakens with each instance); restarts reset all counters | Phase 8: pass a Redis-backed `ThrottlerStorage` into `throttlerOptions(storage)` — the seam already exists, nothing else changes. Until then, run a single API instance or accept the multiplier |
| Web BFF token refresh | Refresh calls are **serialized per refresh token, per process** in the proxy route | Two web instances can race the same rotating refresh token → spurious session invalidation | Sticky sessions on the web target group, or a shared (Redis) lock — flagged for Phase 8. Until then, run a single web instance or enable stickiness |
| File uploads | Written to **local disk** at `UPLOADS_DIR` (default `var/uploads`) | Files are per-instance and lost on task replacement | S3 storage adapter replaces the disk adapter (planned). Until then: single instance, or mount shared storage (EFS) as an interim |
| Realtime (future, Phase 5) | Socket.io connections | Cross-instance events need the Redis adapter (already planned) + LB WebSocket support | Designed-in; note for ALB config |

---

## 8. Local parity — docker-compose

`apps/backend/docker-compose.yml` (project name `towfleet`) mirrors the AWS data stores:

| Service | Image | Host port | Persistence | Profile |
|---|---|---|---|---|
| `postgres` | `postgis/postgis:16-3.4` | 5432 | named volume | default (dev) |
| `redis` | `redis:7` (`--appendonly yes`) | 6379 | named volume | default (dev) |
| `postgres-test` | `postgis/postgis:16-3.4` (`fsync=off`, tmpfs data dir) | 5433 | none (throwaway) | `test` |
| `redis-test` | `redis:7` (no persistence) | 6380 | none | `test` |

Dev credentials all `towfleet` / `towfleet`, DBs `towfleet` / `towfleet_test`. Test profile starts with `docker compose --profile test up -d`. AWS equivalents: RDS for PostgreSQL **with PostGIS extension available** (the very first migration is `0000_enable_postgis`) and ElastiCache Redis 7. Note `redis:7` dev uses AOF persistence; the app also uses Redis pub/sub and GEO commands (location simulator / future realtime), so a cache-only eviction policy is not appropriate.

---

## 9. Decisions needed from the AWS engineer

Genuinely undecided — nothing in the repo pins these:

1. **Region, account layout, instance/task sizing** — no requirements captured anywhere in the repo.
2. **Compute platform** — spec §15 commits to AWS but not to ECS vs. alternatives; graceful-shutdown and log behavior were written with ECS in mind.
3. **Migration execution strategy** — pick one of the three options in §4 (ship tsx, compile the migrator, or dedicated migration task) and where it runs in the pipeline.
4. **Next.js packaging** — enabling `output: 'standalone'` is a code change to `next.config.ts` that must be made and tested as part of Phase 9.
5. **Multi-instance posture at launch** — single instance vs. sticky sessions vs. waiting for the Phase 8 Redis throttler/lock work (see §7).
6. **S3 bucket + cutover plan for uploads** (replaces `UPLOADS_DIR` disk adapter).
7. **Log destination** — NDJSON on stdout is collector-agnostic; choose CloudWatch Logs vs. FireLens → third party.
8. **Secrets delivery** — `JWT_ACCESS_SECRET`, `DATABASE_URL`, `REDIS_URL` need a Secrets Manager / SSM Parameter Store decision; the app only reads plain env vars.

> Decisions in this list are ratified by the owners listed in [01 "Owners & contacts"](01-project-overview.md) — all currently TBD.

---

_Last updated: 03 Aug 2026 · Sources: apps/backend/src/config/env.ts, apps/backend/src/main.ts, apps/backend/package.json, apps/backend/.env.example, apps/backend/Dockerfile, apps/backend/docker-compose.yml, apps/backend/src/db/migrate.ts, apps/backend/src/db/seed/index.ts, apps/backend/src/scripts/simulate-locations.ts, apps/backend/src/common/logging/logger.module.ts, apps/backend/src/common/logging/request-id.middleware.ts, apps/backend/src/common/throttling/throttler.config.ts, apps/backend/src/modules/health/health.controller.ts, apps/towfleet-web/src/lib/env.ts, apps/towfleet-web/.env.example, apps/towfleet-web/package.json, apps/towfleet-web/next.config.ts, Aws/migrations/, Aws/db/schema-snapshot.sql_
