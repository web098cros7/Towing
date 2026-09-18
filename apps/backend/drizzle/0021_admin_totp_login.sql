--
-- ===========================================================================
-- W2 — admin TOTP login state: replay counter and forced password change.
--
-- Two columns, both behaviour-neutral until W2 code lands:
--
--   1. `twofa_last_counter` — the last accepted TOTP time-step (`integer`: the
--      step is `floor(unix/30)`, ~59M today against int4's 2.1B ceiling — no
--      overflow before the year 5138). A code
--      replayed on a FRESH challenge inside its 30-second window is otherwise
--      undetectable (the challenge is new, the code is valid), so the step
--      must be remembered somewhere a restart cannot lose: Postgres, not
--      Redis. Nullable: every existing admin has never completed TOTP.
--   2. `must_change_password` — set by the super-admin password reset (which
--      issues a temporary password). `verify` refuses to mint a session while
--      it is set and points at the completion route instead, so a temp
--      password can never become a standing credential by inattention.
--
-- Hand-written, like every migration from 0002 onward. Separators between
-- statements; journal idx 21; backfills last (none required — nullable and
-- NOT NULL DEFAULT respectively, so every existing row already satisfies
-- both).
-- ===========================================================================
--

ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "twofa_last_counter" integer;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false;--> statement-breakpoint
