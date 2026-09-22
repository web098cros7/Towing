import { z } from 'zod';

/**
 * §19.8's minimum-supported-version gate and §19.9's SEV status banner — W12.
 *
 * NEITHER VALUE HAD A HOME BEFORE THIS. The versions were a Twilio-style
 * "someday" and the banner did not exist at all, so both meant a store release
 * whenever they needed to change. They are one singleton row read through
 * `GET /v1/app-config`, which is PUBLIC on purpose: a build that must
 * force-upgrade to talk to us cannot first be required to talk to us.
 *
 * ONE SHAPE, TWO CONSUMERS. The admin screen reads the same object the handsets
 * read (plus history from `admin_actions`), so a preview of the banner cannot
 * disagree with the banner.
 */
export const appConfigSchema = z.object({
  /** Lowest customer-app semver allowed to keep working. */
  minCustomerVersion: z.string(),
  /** Lowest driver-app semver allowed to keep working. */
  minDriverVersion: z.string(),
  /**
   * When true, a below-minimum build is BLOCKED, not merely warned. The two
   * settings are separate on purpose: warn-then-force is how a rollout is done
   * over days rather than in one scary release.
   */
  forceUpgrade: z.boolean(),
  /** §19.9's severity, or null when there is no incident to announce. */
  sevLevel: z.enum(['sev1', 'sev2', 'sev3']).nullable(),
  sevMessage: z.string().nullable(),
  sevUpdatedAt: z.iso.datetime().nullable(),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * `PUT /v1/admin/app-config` — partial, every field optional, no defaults.
 *
 * The same rule as the pricing and dispatch forms: a save sends what the
 * operator changed and nothing else, so an edit made two minutes after somebody
 * else's leaves theirs alone.
 *
 * `sevLevel` and `sevMessage` must move TOGETHER (the DB CHECK enforces it):
 * clearing the banner means sending both `null`, and a message with no level has
 * no severity to style.
 */
export const adminAppConfigUpdateSchema = z
  .object({
    minCustomerVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'expected a semver like 1.4.2')
      .optional(),
    minDriverVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'expected a semver like 1.4.2')
      .optional(),
    forceUpgrade: z.boolean().optional(),
    sevLevel: z.enum(['sev1', 'sev2', 'sev3']).nullable().optional(),
    sevMessage: z.string().min(3).max(500).nullable().optional(),
    reason: z.string().min(3).max(500).optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'reason'), {
    message: 'Nothing to update',
  })
  .refine((body) => (body.sevLevel === undefined) === (body.sevMessage === undefined), {
    message: 'sevLevel and sevMessage move together — send both to raise or clear the banner',
    path: ['sevLevel'],
  });
export type AdminAppConfigUpdate = z.infer<typeof adminAppConfigUpdateSchema>;
