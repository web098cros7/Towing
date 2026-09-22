--
-- ===========================================================================
-- W2 — a credential change must also invalidate live sessions.
--
-- Migration 0019's trigger bumps `authz_version` on `sub_role`/`status`
-- writes, so a demotion lands within ~5 s. But `resetPassword` (and W2-4's
-- forced-change completion) rewrite `password_hash` without touching either
-- column — and `revokeSubject` only kills the refresh family. The result was
-- proven by `admin-users.e2e.spec.ts`: after a reset, the old ACCESS token
-- (a stateless JWT) stayed valid for the rest of its 900-second life. For a
-- reset — whose whole point is lockout recovery — that is the exact hole A17
-- closed for demotions.
--
-- So the bump condition gains `password_hash`. Any password write bumps the
-- version: `login`/`verify` only touch `failed_attempts`/`last_login_at`, so
-- ordinary logins do not invalidate anything. 0019 itself is FROZEN (applied
-- everywhere) — this replaces the function and re-creates the trigger.
--
-- Hand-written. Separators between statements; journal idx 22; no backfill
-- (a trigger changes future writes, not existing rows).
-- ===========================================================================
--

CREATE OR REPLACE FUNCTION "bump_admin_authz_version"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sub_role" IS DISTINCT FROM OLD."sub_role"
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."password_hash" IS DISTINCT FROM OLD."password_hash" THEN
    NEW."authz_version" := OLD."authz_version" + 1;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_admin_authz_version" ON "admin_users";--> statement-breakpoint
CREATE TRIGGER "trg_admin_authz_version"
  BEFORE UPDATE ON "admin_users"
  FOR EACH ROW EXECUTE FUNCTION "bump_admin_authz_version"();
