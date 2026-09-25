import { Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../../config/config.module';
import { ENV, type Env } from '../../config/env';
import { currentRequestContext } from './request-context';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.middleware';

/**
 * Log storage is effectively permanent and is read by more people than the
 * database, so credentials must never enter it. pino redacts before
 * serialization, so a censored value never reaches the transport at all.
 * The `*.` prefix covers one nesting level, which is where request/response
 * bodies put these fields.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["proxy-authorization"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  'otp',
  'token',
  '*.password',
  '*.otp',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
  '*.secret',
];

/**
 * The bare field names above, for consumers that scrub an object graph rather
 * than a pino log line — today, the Sentry adapter's `beforeSend`.
 *
 * Exported so there is ONE list. A secret added to the logger's redaction and
 * not to the error reporter's would be censored in the logs and shipped
 * verbatim to a third party, which is the worse half of the pair and the half
 * nobody would notice.
 */
export const SENSITIVE_KEYS = [
  'password',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
] as const;

/**
 * Wraps nestjs-pino so the rest of the app only ever imports this module.
 * ConfigModule is imported explicitly rather than leaning on its @Global
 * registration: that makes this module bootable on its own in tests.
 */
/**
 * Access-logged never. `/v1/metrics` joins `/v1/health` because a scrape
 * interval is the same shape of traffic — frequent, uninteresting, and capable
 * of burying every line worth reading.
 *
 * Written WITHOUT the `/v1` prefix: Nest applies the global prefix to
 * middleware exclusions too, and `health/{*splat}` is what covers
 * `/health/queues` and `/health/ledger` as well as `/health` itself.
 */
const SILENT_PATHS = ['health', 'health/{*splat}', 'metrics'];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => ({
        // nestjs-pino registers its middleware for '*', which Express 5 only
        // accepts through a deprecation shim that warns on every boot.
        forRoutes: ['{*splat}'],
        /**
         * Infrastructure endpoints, scraped on a timer by things that are not
         * users: load-balancer health probes (one per target every few seconds)
         * and the Prometheus scrape. Left in, they dominate the log volume and
         * bury the requests worth reading.
         *
         * `exclude` rather than `pinoHttp.autoLogging.ignore`: this is Nest's
         * own middleware route exclusion, so the logger is never even mounted
         * for these paths — which was verified against a running server, unlike
         * the `ignore` predicate, which was silently having no effect here.
         */
        exclude: SILENT_PATHS.map((path) => ({ path, method: RequestMethod.ALL })),
        pinoHttp: {
          level: env.LOG_LEVEL,
          // pino-pretty is a devDependency and costs a worker thread per
          // process; production ships raw NDJSON straight to the collector.
          // A demo server runs the production image in development mode
          // (`deploy.sh demo`), where pino-pretty is not installed: it must
          // fall back to NDJSON rather than crash on start.
          transport:
            env.NODE_ENV === 'production' || !prettyAvailable()
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname',
                  },
                },
          redact: { paths: REDACT_PATHS, censor: '[redacted]' },
          // pino-http only calls this when `req.id` is unset, so whichever of
          // this and RequestIdMiddleware runs first wins and the other reuses
          // the id — the access log, app logs and the response header always
          // carry the same value.
          genReqId: (req, res) => {
            const id = resolveRequestId(req);
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          /**
           * Time spent in SQL, on every access-log line.
           *
           * This is the cheapest question in a performance investigation —
           * "is this endpoint slow because of the database?" — and answering it
           * from the access log turns a k6 run into something you can query
           * afterwards instead of guessing at. The slow-query log covers
           * individual statements; this covers a request made of forty fast
           * ones, which no per-statement threshold would ever surface.
           */
          customProps: () => {
            const store = currentRequestContext();
            return store ? { dbMs: Math.round(store.dbMs), dbCalls: store.dbCalls } : {};
          },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}

/** Whether pino-pretty is installed (it is a devDependency, absent from the production image). */
function prettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}
