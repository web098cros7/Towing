-- Demo service zone: Muzaffarpur, where the simulated tow trucks (sim-job) drive for
-- stakeholder demos. Idempotent. Load on a demo server after db:seed:
--   psql -U towfleet -d towfleet -f muzaffarpur-zone.sql
insert into service_zones (name, code, area, surge_band, is_highway, is_active, dispatch_config, notes) values ('Muzaffarpur (dev test)', 'zone-dev-muzaffarpur', ST_GeogFromText('POLYGON((85.17 25.94,85.57 25.94,85.57 26.3,85.17 26.3,85.17 25.94))'), 'standard', false, true, '{"perService": {"fuel": {"radiusLadderKm": [2, 4, 7]}}, "offersPerWave": 3, "radiusLadderKm": [2, 4, 7, 10, 15], "maxSearchSeconds": 180, "offerTimeoutSeconds": 20}', 'Local dev only (24 Sep 2026): lets Ehsan test from Muzaffarpur.') on conflict (code) do nothing;
