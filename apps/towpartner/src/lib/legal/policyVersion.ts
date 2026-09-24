/**
 * Same policy, same version as MiTow's `lib/legal/policyVersion.ts` — the two
 * must be bumped together. A bump alone does not force re-consent (Phase 12
 * captures consent once per device, see `towpartner.consent.captured.v1` in
 * `storage`); a later phase can compare this against the version recorded by
 * `POST /me/consent` to decide whether to re-prompt.
 */
export const POLICY_VERSION = '2026-08-10';
