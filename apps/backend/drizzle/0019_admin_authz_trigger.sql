--
-- ===========================================================================
-- M0-F10 — the authorization version bumps itself.
--
-- Migration 0018 added `admin_users.authz_version` and the guard that 401s a
-- token older than the row — but the guard only notices a demotion if the
-- writer also bumps the version. A manual SQL fix, or a future path that
-- forgets, would leave the old powers live for up to 900 s. So the bump is a
-- BEFORE UPDATE trigger: any write changing `sub_role` or `status`
-- increments `authz_version`, no matter which code (or console) wrote it.
-- Writers SHOULD still bump it explicitly where natural — the trigger assigns
-- rather than increments-from-NEW, so an explicit bump and the trigger agree
-- instead of double-counting.
--
-- Hand-written, like every migration from 0002 onward.
-- ===========================================================================
--

CREATE OR REPLACE FUNCTION "bump_admin_authz_version"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sub_role" IS DISTINCT FROM OLD."sub_role"
     OR NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."authz_version" := OLD."authz_version" + 1;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_admin_authz_version" ON "admin_users";--> statement-breakpoint
CREATE TRIGGER "trg_admin_authz_version"
  BEFORE UPDATE ON "admin_users"
  FOR EACH ROW EXECUTE FUNCTION "bump_admin_authz_version"();
