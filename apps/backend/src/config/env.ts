import { z } from 'zod';

/**
 * Every env var the backend reads, in one place. Parsed once at boot — a bad or
 * missing value crashes the process with a readable report instead of surfacing
 * as an `undefined` three layers deep at request time.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * Read-replica seam (§9.3.8 AC: "report queries hit read paths"). UNSET is
   * the normal case and is not a degraded mode — the `DB_READER` handle then
   * resolves to the very same pool object as `DB`, so there is no second
   * connection to configure locally, in CI or in a single-instance deploy.
   * Pointing this at an RDS read replica is a Phase 9b capacity decision; the
   * services that must never write already take the reader today.
   */
  DATABASE_READ_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  DATABASE_READ_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // Access tokens are short-lived bearers; refresh tokens rotate and are stored
  // hashed, so only the access secret needs to be a real signing secret.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15m
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30), // 30d

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  /** Root for the disk storage adapter (S3 replaces it in production). */
  UPLOADS_DIR: z.string().default('var/uploads'),

  /**
   * HMAC key for `StoragePort.presignGet`/`presignPut` (Phase 11, §3.1's admin
   * document review). Signs `key + method + exp` so a GET signature cannot be
   * replayed as a PUT and vice versa. Same standing as `JWT_ACCESS_SECRET` — a
   * dev placeholder ships so `pnpm backend` works with zero setup, and
   * `assertProductionSafety` refuses to boot production on it.
   */
  FILE_SIGNING_SECRET: z.string().min(32, 'FILE_SIGNING_SECRET must be >= 32 chars'),

  /** Test-suite escape hatch; never enable in a deployed environment. */
  THROTTLE_DISABLED: z
    .string()
    .default('')
    .transform((v) => v === '1' || v === 'true'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((raw) => raw.split(',').map((o) => o.trim()).filter(Boolean)),

  /**
   * §19.2 kill switch. Off means: the ticket endpoint 503s, the gateway refuses
   * handshakes, and the console drops to 10s REST polling. Having it makes the
   * degradation branch testable rather than aspirational.
   */
  REALTIME_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== '0' && v.toLowerCase() !== 'false'),

  /** Location batch flush cadence — the "<=1/s/truck" of the Phase 5 plan. */
  REALTIME_FLUSH_MS: z.coerce.number().int().positive().default(1_000),

  /**
   * How often driver pings are written through to Postgres (§11.2's "only
   * samples and final positions are persisted"). NOT the same knob as
   * `REALTIME_FLUSH_MS`, which coalesces SOCKET frames on a ~1s window: this one
   * governs DATABASE writes and is two orders of magnitude slower on purpose.
   *
   * 30s matches the driver hash TTL, so the authoritative row is never more
   * stale than the hot key it backs up.
   */
  LOCATION_FLUSH_MS: z.coerce.number().int().positive().default(30_000),

  /** WebSocket handshake tickets are single-use; this is only the outer bound. */
  REALTIME_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  /** Coalesces a burst of domain events into one KPI recompute per fleet. */
  REALTIME_METRICS_DEBOUNCE_MS: z.coerce.number().int().positive().default(2_000),

  /**
   * Origin the browser opens the WebSocket against, handed to the client in the
   * ticket response. Runtime config on purpose: `NEXT_PUBLIC_*` is inlined at
   * `next build`, so splitting the gateway into its own service would otherwise
   * force a web image rebuild.
   */
  PUBLIC_WS_URL: z.url().default('http://localhost:4000'),

  /**
   * Origin a presigned file URL points at (Phase 11, §3.1). Same reasoning as
   * `PUBLIC_WS_URL` above: the browser or driver app hits `GET/PUT
   * /v1/files/:key` directly (it's `@Public()`, no BFF hop needed), so the
   * signer needs the API's externally-reachable origin, not `localhost`.
   */
  PUBLIC_API_URL: z.url().default('http://localhost:4000'),

  /**
   * Off means: nothing is enqueued, no workers start, and no cron is
   * registered. The API stays fully functional — background work is deferred,
   * not lost, because the compliance sweep is idempotent and re-runs cleanly.
   * Lets a task be deployed as API-only, and lets tests opt out.
   */
  QUEUE_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== '0' && v.toLowerCase() !== 'false'),

  /** Jobs processed in parallel per worker per task. */
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(4),

  /**
   * Hourly on the hour by default (§9.3.4 "hourly compliance worker"). The
   * sweep is idempotent, so a denser schedule is safe — it just does less each
   * time.
   */
  COMPLIANCE_SWEEP_CRON: z.string().default('0 * * * *'),

  /**
   * Rows above which a CSV import is handed to the queue instead of being
   * processed in the request (§9.3.4 ">500 rows via queued job").
   */
  BULK_IMPORT_SYNC_MAX_ROWS: z.coerce.number().int().positive().default(500),

  /** Hard ceiling on a single import, whichever path it takes. */
  BULK_IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(10_000),

  // ── Money: ledger, projection, payouts (Phase 7) ────────────────────────

  /**
   * §14.1's "reconciled nightly". 01:00 IST = 19:30 UTC — after the IST day
   * boundary so "yesterday" is closed, and in the trough of the roadside-demand
   * curve. Single-owner across N tasks comes from the BullMQ scheduler's Redis
   * dedup, the same property the compliance cron relies on.
   */
  LEDGER_RECONCILE_CRON: z.string().default('30 19 * * *'),

  /**
   * Zero, and it should stay zero: the invariants are exact by construction
   * (NUMERIC arithmetic, no floats), so any non-zero delta is a bug, not noise.
   * The knob exists so a production incident can be triaged without a redeploy
   * — swallowing a known, already-ticketed delta while the fix ships — not
   * because drift is expected.
   */
  LEDGER_DRIFT_TOLERANCE_PAISE: z.coerce.number().int().min(0).default(0),

  /** Where the drift alarm mails. */
  LEDGER_OPS_EMAIL: z.string().default('ops@towing.local'),

  /**
   * §14.4's "min threshold". The spec requires one and names no number.
   * ₹1,000: Route/IMPS fees are ₹2–5 per transfer, so below roughly this the
   * fee is a material share of the transfer, while a seeded fleet clearing
   * ₹2–6k a day can still withdraw most days.
   *
   * Surfaced in `GET /fleet/earnings` so the console's disabled state is
   * server-driven rather than a second hardcoded copy that can drift.
   */
  PAYOUT_MIN_PAISE: z.coerce.number().int().positive().default(100_000),

  /**
   * ₹5,00,000. Not a product rule — a units-bug guard, so a client that sends
   * rupees where paise are expected cannot request 100× the intent.
   */
  PAYOUT_MAX_PAISE: z.coerce.number().int().positive().default(50_000_000),

  /**
   * Which `PayoutProviderPort` adapter is bound. `dev` is the PERMANENT
   * local-development path — the same standing as `DevOtpAdapter`,
   * `LogNotificationAdapter` and `DiskStorageAdapter`: `pnpm backend` and
   * `pnpm db:seed` must keep working with no Razorpay account, forever.
   * `assertProductionSafety` refuses to boot production on `dev`.
   */
  PAYOUT_PROVIDER: z.enum(['dev', 'razorpay_route']).default('dev'),

  /**
   * HMAC-SHA256 key for `POST /v1/webhooks/razorpay`. The DEV adapter verifies
   * against the same secret with the same algorithm — that is what makes
   * "signature-verification path ready" true rather than aspirational: the
   * path is exercised end to end whichever provider is bound.
   */
  PAYOUT_WEBHOOK_SECRET: z.string().min(16).default('dev-only-webhook-secret-change-me'),

  /** How long the dev adapter waits before settling a payout to `paid`. */
  PAYOUT_DEV_SETTLE_MS: z.coerce.number().int().positive().default(5_000),

  /**
   * §19.3: "a missed webhook is reconciled by scheduled polling (e.g., payment
   * status sweep every 5 min)".
   */
  PAYOUT_RECONCILE_CRON: z.string().default('*/5 * * * *'),

  /**
   * A payout still `requested` with no provider reference after this long never
   * reached the provider — the request-time timeout finally resolving. It is
   * failed, which returns the money to the wallet.
   */
  PAYOUT_STUCK_MINUTES: z.coerce.number().int().positive().default(15),

  /** Razorpay Route credentials. Validated in the adapter's onModuleInit. */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_BASE_URL: z.url().default('https://api.razorpay.com'),

  /** §19.3's 2–5 s external-call budget. Shared by both Razorpay adapters. */
  RAZORPAY_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  // ── Payment gateway, money IN (Phase 19) ────────────────────────────

  /**
   * §14.2's gateway, on its own switch — separate from `PAYOUT_PROVIDER`
   * because Razorpay's payment gateway and RazorpayX Route are different
   * products with independent availability, separate dashboards and separate
   * webhook secrets. One switch for both would mean a payouts outage
   * configured a customer out of paying.
   *
   * The same credentials serve both (`RAZORPAY_KEY_ID`/`_SECRET` above): one
   * merchant, one base URL. `assertProductionSafety` refuses to boot production
   * on `dev`.
   */
  PAYMENT_GATEWAY: z.enum(['dev', 'razorpay']).default('dev'),

  /**
   * HMAC-SHA256 key for the payment half of `POST /v1/webhooks/razorpay`.
   *
   * DISTINCT from `PAYOUT_WEBHOOK_SECRET`, because the two products are
   * configured in separate dashboards and are not obliged to share one. The
   * webhook controller verifies against BOTH and routes by whichever matched,
   * so a deployment that does share one secret still works.
   */
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('dev-only-payment-webhook-secret-change-me'),

  /**
   * How long the dev gateway waits before reporting a payment `captured`.
   *
   * DEFAULT 0, unlike `PAYOUT_DEV_SETTLE_MS`'s 5000, and the asymmetry is
   * honest rather than convenient: a bank transfer is asynchronous by nature,
   * while a UPI or card capture is synchronous from the app's point of view —
   * the sheet returns success. Zero also means the whole chain runs with NO
   * QUEUE AT ALL, which is what the test suite needs (`QUEUE_ENABLED=false`,
   * where a delayed job never fires). Raise it locally to watch §19.2's
   * COMPLETED (unpaid) state.
   */
  PAYMENT_DEV_SETTLE_MS: z.coerce.number().int().min(0).default(0),

  /**
   * §19.3's payment status sweep — "a missed webhook is reconciled by
   * scheduled polling (e.g., payment status sweep every 5 min)", almost
   * verbatim. A BullMQ repeatable, not a cron: `QueuePort.schedule` keys the
   * timer in Redis so N Fargate tasks converge on one, which is exactly the
   * double-capture the §19.4 idempotency ladder should never have to catch.
   */
  PAYMENT_RECONCILE_CRON: z.string().default('*/5 * * * *'),

  /**
   * A payment the gateway has never confirmed after this long is marked
   * `failed` — and the BOOKING STAYS `completed`, per §19.2. Longer than the
   * payout equivalent (15) because a customer can legitimately leave a UPI
   * collect request pending for a while before approving it in their bank app.
   */
  PAYMENT_STUCK_MINUTES: z.coerce.number().int().positive().default(30),

  /**
   * §12.2's weekly earnings summary. Monday 03:30 UTC = 09:00 IST, chosen so
   * it lands in a driver's morning rather than overnight.
   */
  EARNINGS_WEEKLY_CRON: z.string().default('30 3 * * 1'),

  // ── Hardening: multi-instance, observability (Phase 8) ──────────────────

  /**
   * How many reverse proxies sit in front of this process, for Express's
   * `trust proxy`. Governs `req.ip`, which is the throttler's fallback tracker.
   *
   * DEFAULT 0 IS DELIBERATE: with `trust proxy` off, `req.ip` is the socket peer
   * and cannot be influenced by a client. The moment it is non-zero we start
   * believing `X-Forwarded-For`, so the count must match the real topology
   * exactly — too high and the value nearest the client (which the client wrote)
   * is trusted. 1 for a service behind a single ALB.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  /**
   * Rotation leeway (§16.4). N parallel console queries hitting an expired
   * access token all refresh with the SAME token; without a window the losers
   * of the conditional UPDATE look like token theft and the family is revoked,
   * logging the user out. The winner parks its successor pair for this long and
   * the losers replay it.
   *
   * 0 disables the window entirely, restoring the pre-Phase-8 semantics exactly.
   * The trade is stated in `refresh-grace.service.ts`: a stolen token replayed
   * inside the window is not detected until the next rotation.
   */
  REFRESH_GRACE_SECONDS: z.coerce.number().int().min(0).default(10),

  /**
   * Per-minute throttle budgets, one per bucket in `throttler.config.ts`.
   *
   * Env-driven because Phase 8's key change made these mean what they say for
   * the first time — the old key included the handler name, so `reads` was
   * really its limit PER ENDPOINT — and the right numbers are load evidence,
   * not a guess. A knob beats a redeploy while that evidence is being gathered.
   */
  THROTTLE_READS_LIMIT: z.coerce.number().int().positive().default(300),
  THROTTLE_MONEY_LIMIT: z.coerce.number().int().positive().default(20),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(5),
  /**
   * Refresh is its own bucket because it shared the `auth` controller tag: a
   * console holding several tabs can legitimately refresh far more often than
   * it logs in, and 5/min would have logged users out under load.
   */
  THROTTLE_REFRESH_LIMIT: z.coerce.number().int().positive().default(30),
  THROTTLE_REALTIME_LIMIT: z.coerce.number().int().positive().default(60),

  /**
   * Queries slower than this are logged at `warn` with the request id and the
   * truncated SQL — never the parameters, which carry PII.
   *
   * 200 ms is the §19.1 p95 budget for a WHOLE request, so anything at or above
   * it can blow the SLO on its own. 0 disables the timing wrapper.
   */
  DB_SLOW_QUERY_MS: z.coerce.number().int().min(0).default(200),

  /** Truncation length for that SQL. Truncated, not hashed, so it is actionable. */
  DB_SLOW_QUERY_SQL_MAX: z.coerce.number().int().positive().default(300),

  /**
   * Off means `GET /v1/metrics` 404s and no collectors are registered. Tests set
   * it false: prom-client metrics are registry-scoped, and a spec that boots two
   * apps in one file would otherwise depend on the registry plumbing being
   * perfect rather than on it not mattering.
   */
  METRICS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== '0' && v.toLowerCase() !== 'false'),

  /**
   * When set, `GET /v1/metrics` requires `Authorization: Bearer <token>`. Unset
   * leaves it open, matching `/v1/health` — right for local dev, and the reason
   * the endpoint should not be internet-reachable without one.
   */
  METRICS_TOKEN: z.string().optional(),

  /** Unset ⇒ the noop error reporter is bound and nothing is sent anywhere. */
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),

  /**
   * Exposes `GET /v1/fleet/auth/dev/otp?challengeId=…`, which returns the code
   * just issued for that challenge. It exists so a mocks-off browser test can
   * complete the two-step login without scraping the server log.
   *
   * Keyed on the challenge id, so step 1 must already have succeeded with valid
   * credentials — it cannot be used to harvest a code for an arbitrary number.
   * `assertProductionSafety` refuses to boot with it on.
   */
  AUTH_DEV_OTP_ECHO: z
    .string()
    .default('')
    .transform((v) => v === '1' || v === 'true'),

  // --- Social sign-in (Phase 10) --------------------------------------------

  /**
   * Accepted `aud` values for a Google ID token. Comma-separated because there
   * are normally THREE — the web, iOS and Android OAuth clients each have their
   * own id, and a token minted for one is rejected by the others.
   *
   * Empty (the default) means Google sign-in reports itself disabled and
   * `POST /v1/auth/social` refuses it, rather than accepting tokens with no
   * audience check — which would let any Google ID token from any app in the
   * world log in as that user here.
   */
  GOOGLE_OAUTH_CLIENT_IDS: z
    .string()
    .default('')
    .transform((raw) => raw.split(',').map((id) => id.trim()).filter(Boolean)),

  GOOGLE_JWKS_URL: z.url().default('https://www.googleapis.com/oauth2/v3/certs'),

  /** §19.3's external-call budget. A slow JWKS fetch must not hang a login. */
  GOOGLE_JWKS_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),

  /** Floor for the JWKS cache; the response's own `Cache-Control` wins if longer. */
  GOOGLE_JWKS_CACHE_SECONDS: z.coerce.number().int().positive().default(3_600),

  /**
   * Sign in with Apple (§9.1, App Store Guideline 4.8).
   *
   * SHIPS OFF. Phase 13 made `AppleIdentityAdapter` real — it verifies against
   * Apple's JWKS with the same ES256 pinning `GoogleIdentityAdapter` does for
   * RS256 — but it has never seen a token Apple actually minted, because
   * organisation enrolment (D-U-N-S, weeks) has not completed. The flag is the
   * one place that changes when it has; nothing else does.
   */
  APPLE_LOGIN_ENABLED: z
    .string()
    .default('')
    .transform((v) => v === '1' || v === 'true'),

  /**
   * The `aud` values to pin — the iOS bundle id for native sign-in, plus any
   * Services ID used by a web flow. Empty means the adapter reports itself
   * disabled, exactly as `GOOGLE_OAUTH_CLIENT_IDS` empty does, because an
   * unpinned audience accepts any Apple ID token from any app in the world.
   */
  APPLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((raw) => raw.split(',').map((id) => id.trim()).filter(Boolean)),

  APPLE_JWKS_URL: z.url().default('https://appleid.apple.com/auth/keys'),

  /** §19.3's external-call budget — a slow JWKS fetch must not hang a login. */
  APPLE_JWKS_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),

  /** Floor for the JWKS cache; the response's own `Cache-Control` wins if longer. */
  APPLE_JWKS_CACHE_SECONDS: z.coerce.number().int().positive().default(3_600),

  // --- OTP send limits (Phase 10) -------------------------------------------

  /** Window for the per-mobile send cap. A day, because SMS spend is a daily figure. */
  OTP_SEND_WINDOW_SECONDS: z.coerce.number().int().positive().default(86_400),

  /**
   * Codes one number may request per window. The `auth` throttle bucket is a
   * burst limit (5/min); this is the one that bounds the SMS bill, which 5/min
   * sustained does not — that is 7,200 messages a day to one handset.
   */
  OTP_SEND_MAX_PER_WINDOW: z.coerce.number().int().positive().default(10),

  /** Resend cooldown. Returned to the client so its timer matches the server's. */
  OTP_SEND_MIN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),

  // --- Notifications spine (Phase 13, §12) ----------------------------------

  /**
   * Master kill switch for OUTBOUND delivery only.
   *
   * Off means: events are still recorded, in-app notification rows are still
   * written, and every delivery row is stamped `skipped/notifications_disabled`
   * — but nothing is handed to a vendor. It exists so a k6 run or a provider
   * incident is handled by one flag rather than by unbinding four adapters.
   *
   * ⚠ It deliberately does NOT gate `emit()`. The inbox is written inside the
   * producer's own transaction precisely so that turning this off (or running
   * with `QUEUE_ENABLED=false`, which the whole test suite does) still leaves
   * the bell correct. See invariant 74.
   */
  NOTIFY_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== '0' && v.toLowerCase() !== 'false'),

  /**
   * FOUR SWITCHES, NOT ONE. The four channels' credentials arrive at four
   * different times — Firebase and SES production access are separate
   * procurement items, MSG91 needs DLT template registration, WhatsApp needs a
   * BSP plus Meta template approval — so a single `NOTIFICATION_PROVIDER` would
   * make going live all-or-nothing. `log` is the PERMANENT zero-credential
   * path, the same standing as `DevOtpAdapter` and `DiskStorageAdapter`: the
   * whole spine must stay demonstrable with no vendor account, forever.
   */
  NOTIFY_PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
  NOTIFY_SMS_PROVIDER: z.enum(['log', 'msg91']).default('log'),
  NOTIFY_WHATSAPP_PROVIDER: z.enum(['log', 'cloud_api']).default('log'),
  NOTIFY_EMAIL_PROVIDER: z.enum(['log', 'ses']).default('log'),

  /**
   * §19.3's external-call budget, applied to EVERY vendor call through
   * `ExternalCallPolicy` — Maps, MSG91, FCM, WhatsApp, SES, Razorpay. A hung
   * provider socket must not park a queue worker.
   *
   * RENAMED FROM `NOTIFY_*` IN PHASE 14. Phase 13 built the policy and named
   * its knobs after its only consumer; Phase 14 added routing and Phase 19 adds
   * payments, and a Maps timeout read out of a variable called
   * `NOTIFY_CALL_TIMEOUT_MS` is a variable nobody will find. Per-vendor budgets
   * that differ from the default are passed at the call site instead — see
   * `ROUTING_TIMEOUT_MS`, which is far tighter than this because it sits inside
   * §7.6's 2-second estimate guarantee.
   */
  EXTERNAL_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  /** Consecutive failures before the per-vendor breaker opens. */
  EXTERNAL_CALL_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),

  /** How long an open breaker stays open before letting one probe through. */
  EXTERNAL_CALL_BREAKER_RESET_MS: z.coerce.number().int().positive().default(30_000),

  /**
   * §7 road distance. `haversine` is the LIVE DEFAULT and a first-class §19.2
   * path, not a stub: no Google Maps key exists yet (SETUP-CHECKLIST item 7),
   * and a straight-line estimate scaled by `charge_config.haversine_road_factor`
   * is a real fare. `google_distance_matrix` is written and unit-tested but has
   * never called Google.
   */
  ROUTING_PROVIDER: z.enum(['haversine', 'google_distance_matrix']).default('haversine'),

  /** Validated in the adapter's `onModuleInit`, never in its constructor. */
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  GOOGLE_DISTANCE_MATRIX_URL: z
    .url()
    .default('https://maps.googleapis.com/maps/api/distancematrix/json'),

  /**
   * DELIBERATELY TIGHTER THAN §19.3's 2–5 s. This call sits inside
   * `POST /pricing/estimate`, which §7.6 caps at 2 s end to end and §19.1 wants
   * under a 200 ms p95. At 1.5 s a timeout still leaves room to fall back to
   * Haversine — which is instant — and answer inside the guarantee. A 5 s budget
   * here would blow §7.6 while the policy was still being patient.
   */
  ROUTING_TIMEOUT_MS: z.coerce.number().int().positive().default(1_500),

  /**
   * §11.4/§11.5 route lines and ETAs (Phase 18). `haversine` is the LIVE DEFAULT
   * and a first-class §19.2 path for the same reason `ROUTING_PROVIDER`'s is.
   *
   * A THIRD SWITCH RATHER THAN A FOURTH USE OF `ROUTING_PROVIDER`, on the
   * argument `GEOCODING_PROVIDER` already won: Directions is enabled and billed
   * independently of Distance Matrix in Google Cloud — it is currently enabled
   * and dormant on the project (SETUP-CHECKLIST item 7) — so "routes on, fare
   * distances off" is a real configuration somebody will want on the day the
   * Directions bill surprises them.
   */
  DIRECTIONS_PROVIDER: z.enum(['haversine', 'google_directions']).default('haversine'),

  GOOGLE_DIRECTIONS_URL: z
    .url()
    .default('https://maps.googleapis.com/maps/api/directions/json'),

  /**
   * §19.3's full 2–5 s band, unlike `ROUTING_TIMEOUT_MS` — and the contrast is
   * the point. Distance Matrix runs inside §7.6's 2-second estimate guarantee
   * with a customer waiting on a price. This runs once at assignment, after the
   * customer has been told a driver is coming, on a screen that works without
   * it. Nothing is blocked, so patience is cheap and a route obtained slowly
   * beats a straight line for the whole trip.
   */
  DIRECTIONS_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),

  /**
   * §19.8's kill switch for the one thing in this system billed per call on an
   * account with **no hard spend cap** — both cap routes were checked and both
   * are closed for Maps (SETUP-CHECKLIST item 7).
   *
   * Off means every trip still gets a route line and an ETA; they are straight
   * and labelled `haversine`. That is a degradation, not an outage, and it is
   * reachable without a deploy at two in the morning.
   */
  DIRECTIONS_ENABLED: z.coerce.boolean().default(true),

  /**
   * Great-circle → road correction for the ETA fallback, mirroring §7.4's
   * `charge_config.haversine_road_factor` (which is a PRICING knob and stays
   * where the other rates live). Measured over seven real Bengaluru/Chennai
   * routes: mean 1.307, median 1.304, spread 1.203–1.419 — SETUP-CHECKLIST
   * item 7 records the table.
   */
  HAVERSINE_ROUTE_FACTOR: z.coerce.number().positive().default(1.3),

  /**
   * Assumed average speed for the straight-line ETA, km/h. Urban Indian traffic
   * with a tow truck — deliberately pessimistic, because §11.5's whole purpose
   * is that the number does not lurch upward later, and an ETA that improves is
   * a much better experience than one that slips.
   */
  FALLBACK_SPEED_KPH: z.coerce.number().positive().default(22),

  /**
   * Public origin of the §11.7 share page, e.g. `https://towing.app`. The
   * `/t/{token}` URL is composed SERVER-SIDE and returned whole, exactly as
   * `wsUrl` rides the realtime ticket response — relocating the page must not
   * need a mobile release, and two apps composing it themselves would eventually
   * compose it differently.
   */
  PUBLIC_TRACK_BASE_URL: z.url().default('http://localhost:3000'),

  /**
   * §11.7's "expires when the trip completes (+30 min grace)". A knob rather
   * than a constant because the grace exists for a human — somebody following
   * the link who wants to see it ended well — and how long that is worth is an
   * operations question.
   */
  SHARE_LINK_GRACE_MINUTES: z.coerce.number().int().positive().default(30),

  /**
   * §9.1.7 / §9.2.3's call button, behind `TelephonyPort` (Phase 18).
   *
   * `direct` is the LIVE DEFAULT and the permanent local path — but unlike
   * `haversine` or `local` it is NOT a first-class §19.2 rung, and the difference
   * matters. A straight-line ETA is a worse answer to the same question; a direct
   * dial answers a different question, because it hands over a personal phone
   * number that the masked path would never have disclosed. It is honest for
   * development and refused in production (see `assertProductionSafety`).
   *
   * No provider account exists — SETUP-CHECKLIST item 13, still open.
   */
  TELEPHONY_PROVIDER: z.enum(['direct', 'exotel']).default('direct'),

  EXOTEL_BASE_URL: z.url().default('https://api.exotel.com/v1/Accounts'),
  EXOTEL_SID: z.string().optional(),
  EXOTEL_TOKEN: z.string().optional(),
  /** The DID the connect leg originates from. Exotel issues it with the account. */
  EXOTEL_CALLER_ID: z.string().optional(),
  EXOTEL_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),

  /**
   * §9.1.5 address search. `local` is the LIVE DEFAULT and a first-class §19.2
   * path, not a stub: no Places key exists (SETUP-CHECKLIST item 7), and a
   * gazetteer over the two seeded cities exercises the whole typed-address flow
   * end to end. `google_places` is written and unit-tested but has never called
   * Google.
   *
   * A SEPARATE SWITCH FROM `ROUTING_PROVIDER`, even though both spend the same
   * key. The two APIs are enabled independently in Google Cloud and are billed
   * independently, so a project with Distance Matrix on and Places off is a real
   * configuration — and one flag would make turning either on all-or-nothing,
   * the same argument the four `NOTIFY_*_PROVIDER` switches already won.
   */
  GEOCODING_PROVIDER: z.enum(['local', 'google_places']).default('local'),

  GOOGLE_PLACES_URL: z.url().default('https://maps.googleapis.com/maps/api/place'),
  GOOGLE_GEOCODING_URL: z.url().default('https://maps.googleapis.com/maps/api/geocode/json'),

  /**
   * TIGHT BECAUSE A HUMAN IS TYPING, not because of a §7.6-style guarantee. A
   * suggestion list that lands after the next keystroke has already been sent is
   * worse than no list, so a slow answer is not worth waiting for even when it
   * would eventually be right — the gazetteer replies in microseconds.
   */
  GEOCODING_TIMEOUT_MS: z.coerce.number().int().positive().default(1_200),

  /**
   * Re-enqueues events that never fanned out and deliveries stranded in
   * `queued` — the repair for a process that died between a commit and its
   * enqueue. Every 5 minutes, deduplicated across tasks by `QueuePort`.
   */
  NOTIFY_SWEEP_CRON: z.string().default('*/5 * * * *'),

  /** A delivery still `queued` after this long is considered stranded. */
  NOTIFY_STRANDED_MINUTES: z.coerce.number().int().positive().default(5),

  /**
   * Expo push. No account or key is needed to SEND — the access token is
   * optional and only raises rate limits — but a working push still requires an
   * FCM server key (Android) and an APNs key (iOS) uploaded to the Expo
   * project, neither of which exists yet. See `ToBeDoneEhsan.md`.
   */
  EXPO_PUSH_URL: z.url().default('https://exp.host/--/api/v2/push/send'),
  EXPO_PUSH_RECEIPTS_URL: z.url().default('https://exp.host/--/api/v2/push/getReceipts'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  /**
   * How long after a send the receipts job asks Expo what happened. Expo
   * returns `DeviceNotRegistered` HERE, not in the send ticket — polling this
   * is the only thing that ever prunes a token belonging to an uninstalled app.
   */
  EXPO_RECEIPT_DELAY_MS: z.coerce.number().int().positive().default(900_000),

  /** MSG91 SMS. Validated in the adapter's onModuleInit, never in its constructor. */
  MSG91_BASE_URL: z.url().default('https://control.msg91.com'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),

  /** WhatsApp Cloud API. `WHATSAPP_PHONE_NUMBER_ID` is the sender, not a phone number. */
  WHATSAPP_BASE_URL: z.url().default('https://graph.facebook.com/v21.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),

  /** Amazon SES. Region and credentials come from the standard AWS chain. */
  SES_REGION: z.string().default('ap-south-1'),
  SES_FROM_EMAIL: z.string().default('no-reply@towing.local'),
});

export type Env = z.infer<typeof EnvSchema>;

/** DI token — inject with `@Inject(ENV)` rather than reaching for process.env. */
export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const report = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${report}`);
  }

  return parsed.data;
}

/**
 * Dev-only guard: a production deploy that silently falls back to the checked-in
 * sample secret would be far worse than failing to boot.
 */
export function assertProductionSafety(env: Env): void {
  if (env.NODE_ENV !== 'production') return;

  if (env.JWT_ACCESS_SECRET.includes('dev-only')) {
    throw new Error('JWT_ACCESS_SECRET is still the development placeholder');
  }

  if (env.FILE_SIGNING_SECRET.includes('dev-only')) {
    throw new Error('FILE_SIGNING_SECRET is still the development placeholder');
  }

  // The dev payout adapter marks payouts `paid` on a timer without a bank ever
  // being involved. In production that is a ledger full of money nobody sent.
  if (env.PAYOUT_PROVIDER === 'dev') {
    throw new Error('The dev payout adapter must never run in production — set PAYOUT_PROVIDER');
  }

  if (env.PAYOUT_WEBHOOK_SECRET.includes('dev-only')) {
    throw new Error('PAYOUT_WEBHOOK_SECRET is still the development placeholder');
  }

  // Same standing, same reason, other direction: a gateway that reports every
  // payment captured with no bank involved credits drivers from money nobody
  // ever sent — and every ledger invariant stays green while it does, because
  // they all reconcile against what the booking SAYS it charged.
  if (env.PAYMENT_GATEWAY === 'dev') {
    throw new Error('The dev payment gateway must never run in production — set PAYMENT_GATEWAY');
  }

  if (env.PAYMENT_WEBHOOK_SECRET.includes('dev-only')) {
    throw new Error('PAYMENT_WEBHOOK_SECRET is still the development placeholder');
  }

  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production');
  }

  // The dev OTP echo hands a live second factor to anyone who can reach the
  // route and has completed step 1. It exists for the mocks-off browser test.
  if (env.AUTH_DEV_OTP_ECHO) {
    throw new Error('AUTH_DEV_OTP_ECHO must never be set in production');
  }

  // The Apple adapter is REAL as of Phase 13 — it verifies against Apple's
  // JWKS exactly as the Google one does — but it has still never seen a token
  // Apple actually minted, because organisation enrolment (D-U-N-S, weeks) has
  // not completed. The refusal therefore moved from "not supported yet" to
  // "not configured": without client ids there is no `aud` to pin, and an
  // unpinned audience would accept ANY Apple ID token from ANY app in the
  // world as this user. Same rule `GOOGLE_OAUTH_CLIENT_IDS` already enforces
  // via `GoogleIdentityAdapter.enabled`.
  if (env.APPLE_LOGIN_ENABLED && env.APPLE_CLIENT_IDS.length === 0) {
    throw new Error(
      'APPLE_LOGIN_ENABLED is set but APPLE_CLIENT_IDS is empty — there is no audience to pin',
    );
  }

  // Notification providers are NOT refused on `log` in production, deliberately.
  // WhatsApp needs a BSP plus Meta template approval and SES needs a support
  // review; making either a hard boot failure would turn a procurement item
  // into a launch blocker, which is the opposite of the dev-safe-default rule.
  // A WARN is emitted at startup instead (see `NotificationRouterAdapter`).
  //
  // What IS refused is a real adapter pointed at a placeholder — that is a
  // misconfiguration, not a deferral, and it fails at the first send otherwise.
  if (env.NOTIFY_EMAIL_PROVIDER === 'ses' && env.SES_FROM_EMAIL.endsWith('.local')) {
    throw new Error('SES_FROM_EMAIL is still the development placeholder');
  }

  if (env.NOTIFY_SMS_PROVIDER === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_SENDER_ID)) {
    throw new Error('MSG91_AUTH_KEY and MSG91_SENDER_ID are required when NOTIFY_SMS_PROVIDER=msg91');
  }

  if (
    env.NOTIFY_WHATSAPP_PROVIDER === 'cloud_api' &&
    (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN)
  ) {
    throw new Error(
      'WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are required when NOTIFY_WHATSAPP_PROVIDER=cloud_api',
    );
  }

  // Routing follows the SAME split as the notification channels, for the same
  // reason. `ROUTING_PROVIDER=haversine` in production is ALLOWED: it is a real
  // §19.2 path that the breaker falls back to anyway, and refusing it would
  // make a Google Cloud billing account a launch blocker. What is refused is
  // the misconfiguration — the real adapter selected with nothing to call.
  if (env.ROUTING_PROVIDER === 'google_distance_matrix' && !env.GOOGLE_MAPS_API_KEY) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY is required when ROUTING_PROVIDER=google_distance_matrix',
    );
  }

  // Geocoding follows routing exactly. `GEOCODING_PROVIDER=local` in production
  // is ALLOWED — it is a real §19.2 path the breaker falls back to anyway, and
  // refusing it would make a Google Cloud billing account a launch blocker. What
  // is refused is the misconfiguration: the real adapter selected with nothing
  // to call.
  if (env.GEOCODING_PROVIDER === 'google_places' && !env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is required when GEOCODING_PROVIDER=google_places');
  }

  // Directions, identically (Phase 18). `haversine` in production is ALLOWED and
  // is what the breaker falls back to; the misconfiguration is refused.
  if (env.DIRECTIONS_PROVIDER === 'google_directions' && !env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is required when DIRECTIONS_PROVIDER=google_directions');
  }

  // §11.7's share links are composed against this origin and sent to people
  // outside the app — over WhatsApp, to a spouse standing beside a broken car.
  // A production build that ships `http://localhost:3000` produces a link that
  // is not merely broken but confusing, and it is unrecoverable once sent.
  if (env.PUBLIC_TRACK_BASE_URL.includes('localhost')) {
    throw new Error('PUBLIC_TRACK_BASE_URL must be a public origin in production');
  }

  // §11.7 and §9.1.7 both promise the other party can be reached WITHOUT either
  // real number being exposed. The direct-dial adapter is the permanent local
  // path and an honest dev default — in production it publishes a customer's
  // personal mobile to every driver who is offered their job, which is a privacy
  // commitment (§20.4) broken by a default rather than a decision.
  //
  // Same standing as `PAYOUT_PROVIDER=dev`, and refused for the same reason: it
  // works, which is exactly what makes shipping it by accident plausible. The
  // masked-calling account is SETUP-CHECKLIST item 13.
  if (env.TELEPHONY_PROVIDER === 'direct') {
    throw new Error(
      'TELEPHONY_PROVIDER=direct exposes both parties real numbers — configure a masked-calling provider in production',
    );
  }

  if (env.TELEPHONY_PROVIDER === 'exotel' && (!env.EXOTEL_SID || !env.EXOTEL_TOKEN)) {
    throw new Error('EXOTEL_SID and EXOTEL_TOKEN are required when TELEPHONY_PROVIDER=exotel');
  }
}

