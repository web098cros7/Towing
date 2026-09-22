--
-- Consent withdrawal (§20.4 DPDP).
--
-- `consent_records` was an append-only log of agreements with no way to record
-- the opposite, although the consent overlay every customer signs tells them in
-- as many words: "You can withdraw consent anytime from Settings." Nothing in
-- Settings could, and nothing on the server could have recorded it.
--
-- An `action` column rather than a `withdrawn_at` timestamp on the granting
-- row: consent can be given, withdrawn and given again, and each of those is a
-- separate dated fact a regulator may ask about. Mutating the original row
-- would throw the history away and leave "when did they agree?" unanswerable.
-- The current state of a policy for a subject is its newest row.
--
-- DEFAULT 'granted' backfills every existing row correctly, because until now
-- an agreement was the only thing this table could hold.
--
ALTER TABLE consent_records
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'granted';

ALTER TABLE consent_records
  DROP CONSTRAINT IF EXISTS ck_consent_records_action;

ALTER TABLE consent_records
  ADD CONSTRAINT ck_consent_records_action
  CHECK (action IN ('granted', 'withdrawn'));

-- The read this powers is "the newest row for this subject and policy".
CREATE INDEX IF NOT EXISTS idx_consent_records_subject_policy
  ON consent_records (subject_id, subject_type, policy_type, consented_at DESC);
