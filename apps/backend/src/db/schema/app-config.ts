import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';

/**
 * W12 — §19.8's minimum-supported-version gate and §19.9's SEV status banner,
 * as one singleton row.
 *
 * NEITHER VALUE HAD A HOME BEFORE THIS. A build gate that lives in a store
 * release cannot close when a release is broken, which is exactly the moment it
 * exists for; and a status banner nobody can raise without a deploy is a banner
 * that appears a day late.
 *
 * IT IS READ WITHOUT A SESSION, through `GET /v1/app-config`. That is not a
 * convenience: a client below the minimum version must still be able to learn
 * that it is below the minimum version, so the endpoint it asks cannot require
 * the very session its version is being checked against.
 *
 * WHY THE VERSIONS AND THE BANNER SHARE A ROW. Both are "what every app needs
 * to know at launch, and nothing else", and they change in the same moments
 * (an incident, a bad release). One row means the public endpoint is one read.
 */
export const appConfig = pgTable(
  'app_config',
  {
    id: primaryId(),
    /** Always `true`; UNIQUE + CHECK make this table hold exactly one row. */
    singleton: boolean('singleton').notNull().default(true),
    /** Lowest customer-app semver allowed to keep working. */
    minCustomerVersion: text('min_customer_version').notNull().default('1.0.0'),
    minDriverVersion: text('min_driver_version').notNull().default('1.0.0'),
    /**
     * Block rather than warn. Separate from the versions on purpose: warning
     * first and forcing days later is how a rollout actually happens.
     */
    forceUpgrade: boolean('force_upgrade').notNull().default(false),
    /** `sev1` · `sev2` · `sev3`, or NULL when there is no incident. CHECKed in 0027. */
    sevLevel: text('sev_level'),
    sevMessage: text('sev_message'),
    sevUpdatedAt: timestamp('sev_updated_at', { withTimezone: true }),
    /** The support line and inbox the customer app shows (migration 0035). */
    supportPhone: text('support_phone').notNull().default('+911800123456'),
    supportEmail: text('support_email').notNull().default('support@mitow.in'),
    /** Refer & Earn (Figma 45): wallet credit to each side on the referee's first paid trip. */
    referrerRewardPaise: integer('referrer_reward_paise').notNull().default(10000),
    refereeRewardPaise: integer('referee_reward_paise').notNull().default(10000),
    ...timestamps,
  },
  (t) => [uniqueIndex('app_config_singleton_unique').on(t.singleton)],
);
