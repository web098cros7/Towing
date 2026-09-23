--
-- A driver says which roadside jobs they can actually do.
--
-- Dispatch matched a driver to a booking on `vehicle_class` and nothing else.
-- That is the right rule for a tow — a wheel-lift job needs a wheel-lift — but
-- it is no rule at all for the five roadside services, which the `service_type`
-- comment has always said are "open to both truck classes". Open to both
-- classes meant open to everyone: a flatbed carrying no jump pack was offered
-- battery jobs, and the only way anyone found out was the driver declining, or
-- worse, arriving.
--
-- Ehsan's call (23 Sep): the driver picks these during onboarding, and dispatch
-- matches on the answer.
--
-- The column holds the ROADSIDE set only. Tow and accident recovery are not in
-- it, on purpose — `vehicle_class` already decides those, and a second copy of
-- the same fact is a second thing to keep in sync.
--
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS services service_type[] NOT NULL DEFAULT ARRAY[]::service_type[];

--
-- Backfill every EXISTING driver with all five.
--
-- Not a guess about their kit — a refusal to change their supply in a
-- migration. They were already receiving these offers this morning; a column
-- default of empty would take that away overnight, with no notice and no
-- screen to fix it on. They keep what they had and can untick what they do not
-- carry. NEW drivers start empty and tick their way in, which is the rule going
-- forward.
--
-- Scoped to rows still at the old default so a re-run cannot overwrite a
-- driver's real choices.
--
UPDATE drivers
   SET services = ARRAY['battery', 'flat_tyre', 'fuel', 'breakdown', 'lockout']::service_type[]
 WHERE services = ARRAY[]::service_type[];

--
-- The dispatch eligibility read asks "does this driver's set contain the
-- booking's service type" for every driver a wave found. GIN is the index for
-- array containment; btree cannot answer `@>` at all.
--
CREATE INDEX IF NOT EXISTS idx_drivers_services ON drivers USING GIN (services);
