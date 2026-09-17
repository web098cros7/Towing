import { themeCss, type RealmAccent } from './css-vars';

/**
 * Server-renderable <style> tag emitting the semantic CSS variables for a
 * realm. Place once in the root layout <head> — everything else (Tailwind
 * utilities, components) reads the variables.
 *
 * `scope` defaults to `:root`. An admin subtree wrapper passes
 * `scope='[data-realm="admin"]'` so its declaration wins for that subtree by
 * inheritance while the fleet console stays untouched.
 */
export function ThemeStyles({ accent, scope }: { accent: RealmAccent; scope?: string }) {
  return (
    <style data-towing-theme="" dangerouslySetInnerHTML={{ __html: themeCss(accent, scope) }} />
  );
}
