import { Injectable } from '@nestjs/common';
import type { Recipient, RegisteredTrigger } from './registry/trigger.types';

/**
 * §12.3's "per-user notification preferences (channel opt-outs where legally
 * allowed; transactional/safety always on)".
 *
 * ⚠ THIS RUNS IN THE FAN-OUT WORKER, NEVER AT A CALL SITE (invariant 71). A
 * producer that decided "should I send this?" is a producer that can decide
 * wrong, and there would be one such decision per emitter forever. Here there
 * is exactly one.
 *
 * The opt-out surface is deliberately small. `subjectNotificationPrefsSchema`
 * carries a key ONLY for a category a person may legally switch off; everything
 * else is unsuppressible by construction rather than by a default that a future
 * migration could flip. A user opt-out must never be able to suppress a KYC
 * rejection, a payout failure, or (since W14) an SOS.
 */
@Injectable()
export class PreferenceService {
  /**
   * @returns the `skip_reason` if this recipient has opted out, else null.
   */
  suppresses(recipient: Recipient, trigger: RegisteredTrigger<never>): 'suppressed_by_pref' | null {
    // Transactional and safety rows bypass preferences entirely. This is the
    // §12.3 rule, and it is checked first so no later branch can weaken it.
    if (trigger.alwaysOn) return null;

    if (recipient.subjectType === 'fleet') {
      // A fleet reads the CONSOLE's own toggles (`fleets.notification_prefs`,
      // shipped in Phase 7 with keys compliance/payouts/jobs/weekly), not the
      // per-subject shape. Consulting the per-subject keys here would have left
      // the switch a fleet owner can already see and flip wired to nothing.
      const key = FLEET_PREF_KEY[trigger.category];
      if (key && recipient.prefs[key] === false) return 'suppressed_by_pref';
      return null;
    }

    const key = SUBJECT_PREF_KEY[trigger.category];
    if (key && recipient.prefs[key] === false) return 'suppressed_by_pref';
    return null;
  }
}

/**
 * Category → the `fleets.notification_prefs` key it answers to. Categories
 * absent from this map are always-on for a fleet.
 */
const FLEET_PREF_KEY: Partial<Record<string, string>> = {
  compliance: 'compliance',
  money: 'payouts',
  job: 'jobs',
};

/**
 * Category → the `users`/`drivers` `notification_prefs` key. Only two
 * categories are opt-out-able; the rest are absent on purpose.
 */
const SUBJECT_PREF_KEY: Partial<Record<string, string>> = {
  promotions: 'promotions',
};
