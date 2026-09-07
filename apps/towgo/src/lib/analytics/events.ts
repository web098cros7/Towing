/**
 * §22.1 — the input to every launch-cohort KPI (activation %, fill rate,
 * repeat-booking rate...). Events not emitted at launch cannot be recovered
 * for the launch cohort, which is why this exists now even though most rows
 * below aren't emitted until a later phase installs the feature that fires
 * them. Phase 12 emits exactly `app_open`/`signup_start`/`signup_complete`;
 * the rest are named here so each later phase has a stable event name to
 * emit into, not something it invents ad hoc.
 */
export interface AnalyticsEventMap {
  app_open: Record<string, never>;
  signup_start: Record<string, never>;
  signup_complete: Record<string, never>;
  /** Phase 13 — the OS permission answer, so prompt-accept rate is measurable from day one. */
  push_permission_granted: Record<string, never>;
  push_permission_denied: Record<string, never>;
  /** Phase 13 — the bell was opened. Distinguishes notified from noticed. */
  notification_opened: Record<string, never>;
  /**
   * Phase 14 — the §9.1.5 funnel's first two steps.
   *
   * `service_selected` fires when the customer picks a catalogue entry;
   * `estimate_viewed` when a FARE LANDS, not when the screen mounts, so it
   * measures quotes seen rather than screens opened. Together with
   * `booking_confirmed` (Phase 15) they are the drop-off funnel behind §2.5's
   * booking-conversion KPI — and §22.1's rule is that an event not emitted at
   * launch cannot be recovered for the launch cohort.
   */
  service_selected: { slug: string };
  estimate_viewed: Record<string, never>;
  /**
   * Phase 15 — the §9.1.5 funnel's last step. Fires on a CONFIRMED booking, so
   * `estimate_viewed → booking_confirmed` is the conversion rate §2.5 asks for.
   */
  booking_confirmed: Record<string, never>;
  /**
   * Phase 18 — §11.7's share link was actually SENT.
   *
   * Emitted after the OS share sheet returns, not when the button is tapped: a
   * dismissed sheet is a customer who changed their mind, and counting it would
   * overstate the one safety feature whose adoption is worth knowing honestly.
   */
  trip_shared: Record<string, never>;
  /**
   * §22.1's — and the ONLY two payment events this app emits.
   *
   * `booking_completed`, `payment_success`, `payment_failure` and
   * `booking_cancelled` are all emitted SERVER-SIDE, at the ledger and
   * state-machine truth points, and deliberately not here: a client-emitted
   * `payment_success` counts SHEETS THAT RETURNED SUCCESS, which is not the
   * same fact as money landing — and two numbers for one KPI is exactly what
   * §2.5's dashboards would then have to reconcile.
   *
   * These two are the ones the server genuinely cannot see. It knows it created
   * an intent; it cannot know whether a sheet appeared or why it closed. The
   * gap between `payment_sheet_opened` and the server's `payment_success` is
   * the checkout abandonment rate, which nothing else measures.
   */
  payment_sheet_opened: Record<string, never>;
  payment_sheet_dismissed: { reason: 'cancelled' | 'error' };

  // Phase 20: sos_triggered
}

export type AnalyticsEventName = keyof AnalyticsEventMap;
