/**
 * The name the app shows for a `services.slug`, for the screens that name a BOOKED service:
 * 27 · Payment's Service row (28's backdrop is 27 itself) and 30 · Payment Successful's.
 *
 * ⚠ KEEP THESE WORDS IN STEP with the two places that already name the services on screen:
 * Home's service tiles (`SERVICE_TILES` in `screens/home/HomeScreen.tsx`, where some labels
 * carry a hard break, "Battery\nJump Start") and 09 Roadside's cards (`ROADSIDE_SERVICES` in
 * `screens/services/roadside/roadsideServices.data.ts`). The words are theirs, verbatim, on one
 * line. They are copied rather than imported because a feature never imports from a screen.
 *
 * A slug no screen names yet (`bike_tow`, `flatbed_tow`, `wheel_lift_tow`,
 * `accident_recovery`, or a catalogue row added later) has no title: the row keeps its
 * placeholder bar rather than inventing a name.
 */
const SERVICE_TITLES: ReadonlyMap<string, string> = new Map([
  ['car_tow', 'Tow a Car'],
  ['battery', 'Battery Jump Start'],
  ['flat_tyre', 'Flat Tyre Support'],
  ['fuel', 'Out of Fuel'],
  ['lockout', 'Car Lockout'],
  ['breakdown', 'Minor Mechanical Help'],
]);

/** The service's on-screen name, or null for a missing or unnamed slug (see above). */
export function serviceTitle(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return SERVICE_TITLES.get(slug) ?? null;
}
