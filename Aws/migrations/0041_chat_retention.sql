--
-- Chat is kept 90 days, not forever (ADM-18, 23 Sep).
--
-- The driver-customer chat (0035) arrived after G16's retention schedule
-- (0033), so nothing ever deleted it. Ehsan set the dispute window at three
-- hours at most; 90 days is ADM-18's default for message logs and leaves room
-- for what surfaces later than a dispute, like a safety complaint or a police
-- request about a trip.
--
-- The nightly sweep (`sweepRetention`) enforces it, and holds the chat of any
-- booking whose dispute is not yet resolved.
--
-- ON CONFLICT DO NOTHING: an operator who already added this key by hand keeps
-- their number.
--
INSERT INTO "retention_policies" ("policy_key", "retention_days", "description") VALUES
  ('chat_messages', 90, 'booking_messages (driver-customer chat) — 90 days. Swept nightly, except on a booking with a dispute still open.')
ON CONFLICT ("policy_key") DO NOTHING;
