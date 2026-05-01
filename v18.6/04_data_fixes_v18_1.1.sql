-- ─────────────────────────────────────────────────────────────────────────
--  HILLARY OUTDOORS GMS — v18.1.1 data fix migration  (REPLACES v18.1)
--
--  Discard v18.1 (it rolled back due to gear_id sequence drift). This file
--  re-runs the same fixes plus:
--    - Pre-flight sequence resync (fixes the duplicate-key error)
--    - T18: 18 locker lists, each containing all gear at that locker
--
--  BACK UP THE DATABASE BEFORE RUNNING.
--  Supabase Dashboard → Database → Backups → Manual backup.
-- ─────────────────────────────────────────────────────────────────────────


-- ── PRE-FLIGHT: resync sequences ────────────────────────────────────────────
-- After CSV imports / manual inserts, the auto-increment sequences for tables
-- with serial PKs drift behind the actual MAX(id). Re-bumping them now means
-- every subsequent INSERT in this migration gets a fresh, conflict-free ID.
SELECT setval(pg_get_serial_sequence('public.gear',     'gear_id'),
              GREATEST((SELECT COALESCE(MAX(gear_id),     0) FROM public.gear),     1));
SELECT setval(pg_get_serial_sequence('public.list_gear', 'id'),
              GREATEST((SELECT COALESCE(MAX(id),          0) FROM public.list_gear), 1));
SELECT setval(pg_get_serial_sequence('public.usage',    'usage_id'),
              GREATEST((SELECT COALESCE(MAX(usage_id),    0) FROM public.usage),    1));
SELECT setval(pg_get_serial_sequence('public.fuel_log', 'fuel_id'),
              GREATEST((SELECT COALESCE(MAX(fuel_id),     0) FROM public.fuel_log), 1));
SELECT setval(pg_get_serial_sequence('public.reports',  'report_id'),
              GREATEST((SELECT COALESCE(MAX(report_id),   0) FROM public.reports),  1));
SELECT setval(pg_get_serial_sequence('public.workflow', 'wf_id'),
              GREATEST((SELECT COALESCE(MAX(wf_id),       0) FROM public.workflow), 1));
SELECT setval(pg_get_serial_sequence('public.prev_purchases','prev_id'),
              GREATEST((SELECT COALESCE(MAX(prev_id),     0) FROM public.prev_purchases),1));


BEGIN;

-- Suspend the list_gear behaviour-lock trigger so we can freely move gear
-- between categories during this migration without per-row trigger overhead.
SET session_replication_role = 'replica';
-- T1. Reassign belay devices
-- ─────────────────────────────────────────────────────────────
UPDATE public.gear SET category_id = 'cat_atcs'      WHERE gear_id IN (24,25,26,27,28,29,30,31,32,33,34,35,47,48,49,50,51,52);
UPDATE public.gear SET category_id = 'cat_atc_guide' WHERE gear_id IN (12,13,14,15,16,17,18,19,20,21,22,23);
UPDATE public.gear SET category_id = 'cat_figure_8'  WHERE gear_id IN (36,37,38,39,40,41,42,43,44,45,46,53,54,55,56,57,58);
UPDATE public.gear SET category_id = 'cat_gri_gri'   WHERE gear_id IN (59,60,61,62,63,64,65,66,67,68,69,70);

-- ─────────────────────────────────────────────────────────────
-- T3. Reassign carabiners by material
-- ─────────────────────────────────────────────────────────────
-- 36 alloy carabiners → cat_alloy_carabiners (created below if missing)
-- 4 steel carabiners → cat_steel_carabiners

-- Create the new carabiner subcategories if they don't yet exist.
INSERT INTO public.categories (cat_id, name, description, target_stock, life_safety, behaviour, budget_owner, sized_pool_style)
VALUES
  ('cat_alloy_carabiners', 'Alloy Carabiners', 'Aluminium / alloy carabiners — cheaper, lighter, faster to consume', 50, true, 'signable', 'resource', NULL),
  ('cat_steel_carabiners', 'Steel Carabiners', 'Steel carabiners — for top anchors, rescue, longer-life applications', 12, true, 'signable', 'resource', NULL)
ON CONFLICT (cat_id) DO NOTHING;

UPDATE public.gear SET category_id = 'cat_alloy_carabiners' WHERE gear_id IN (191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226);
UPDATE public.gear SET category_id = 'cat_steel_carabiners' WHERE gear_id IN (241,242,243,244);

-- ─────────────────────────────────────────────────────────────
-- T15. Add new locations needed for taxonomy items
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.locations (loc_id, name, description, active) VALUES
  ('loc_pool',             'Pool',             'Indoor swimming pool', true),
  ('loc_container_3',      'Container 3',      'Yard container 3 — canoes', true),
  ('loc_tech_container_5', 'Tech Container 5', 'Tech container 5 — kayak paddles', true)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- T2. Trad racks — wipe existing 90 rows, rebuild 6 racks × 44 items = 264
-- ─────────────────────────────────────────────────────────────
-- Drop old trad rack list_gear links and the auto-generated lists from earlier import
DELETE FROM public.list_gear  WHERE list_id IN (SELECT list_id FROM public.lists WHERE name ILIKE '%trad rack%' AND description ILIKE '%auto-exploded%');
DELETE FROM public.lists      WHERE name ILIKE '%trad rack%' AND description ILIKE '%auto-exploded%';
-- Wipe existing trad rack gear rows (camming_devices category, item containing 'Trad Rack')
DELETE FROM public.list_gear WHERE gear_id IN (SELECT gear_id FROM public.gear WHERE category_id='camming_devices' AND item ILIKE '%trad rack%');
DELETE FROM public.gear      WHERE category_id='camming_devices' AND item ILIKE '%trad rack%';

-- Insert 264 new rows. We use a single INSERT with VALUES to keep the SQL compact.
-- Columns: gear_id is auto-allocated (DEFAULT) — we get post-insert IDs in T17 via a CTE.
INSERT INTO public.gear (item, category_id, status, expiry, number_of_uses, usage_limit, signed_in_out, location, physical_serial, is_pool_bucket, pool_count, pool_capacity, set_size)
VALUES
  ('Tech Climbing Room Trad Rack Yellow Cam 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Cam 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Cam-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 15', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-15', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut 16', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Nut-16', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Hex 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Hex-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Hex 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Hex-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Hex 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Hex-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut Tool 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-NutTool-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Nut Tool 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-NutTool-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow Snap 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Yellow-Snap-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Cam 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Cam-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 15', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-15', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut 16', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Nut-16', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Hex 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Hex-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Hex 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Hex-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Hex 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Hex-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut Tool 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-NutTool-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Nut Tool 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-NutTool-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Red Snap 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Red-Snap-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 1', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 2', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 3', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 4', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 5', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 6', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 7', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 8', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Cam 9', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Cam-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 1', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 2', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 3', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 4', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 5', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 6', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 7', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 8', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 9', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 10', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 11', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 12', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 13', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 14', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 15', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-15', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut 16', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Nut-16', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Hex 1', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Hex-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Hex 2', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Hex-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Hex 3', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Hex-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut Tool 1', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-NutTool-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Nut Tool 2', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-NutTool-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 1', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 2', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 3', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 4', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 5', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 6', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 7', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 8', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 9', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 10', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 11', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 12', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 13', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Green Snap 14', 'camming_devices', 'Green', '2035-12-30', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Green-Snap-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Cam 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Cam-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 15', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-15', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut 16', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Nut-16', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Hex 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Hex-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Hex 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Hex-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Hex 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Hex-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut Tool 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-NutTool-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Nut Tool 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-NutTool-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack White Snap 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-White-Snap-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Cam 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Cam-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 15', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-15', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut 16', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Nut-16', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Hex 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Hex-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Hex 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Hex-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Hex 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Hex-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut Tool 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-NutTool-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Nut Tool 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-NutTool-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Blue Snap 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-Blue-Snap-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Cam 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Cam-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-14', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 15', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-15', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut 16', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Nut-16', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Hex 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Hex-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Hex 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Hex-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Hex 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Hex-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut Tool 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-NutTool-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Nut Tool 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-NutTool-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 1', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-01', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 2', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-02', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 3', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-03', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 4', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-04', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 5', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-05', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 6', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-06', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 7', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-07', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 8', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-08', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 9', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-09', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 10', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-10', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 11', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-11', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 12', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-12', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 13', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-13', false, NULL, NULL, NULL),
  ('Tech Climbing Room Trad Rack Yellow-Green Snap 14', 'camming_devices', 'Green', '2051-04-22', 0, 200, 'IN', 'Tech Climbing Room', 'TR-YellowGreen-Snap-14', false, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────
-- T4. Locker helmets — wipe all 112 rows, rebuild 18 lockers × 12 helmets = 216
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.list_gear WHERE gear_id IN (SELECT gear_id FROM public.gear WHERE category_id='locker_helmets');
DELETE FROM public.gear      WHERE category_id='locker_helmets';

INSERT INTO public.gear (item, category_id, status, expiry, number_of_uses, usage_limit, signed_in_out, location, physical_serial, is_pool_bucket, pool_count, pool_capacity, set_size)
VALUES
  ('Locker 01 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/A', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/B', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/C', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/D', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/E', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/F', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/G', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/H', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/I', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/J', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/K', false, NULL, NULL, NULL),
  ('Locker 01 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 01', 'Locker 01/L', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/A', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/B', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/C', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/D', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/E', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/F', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/G', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/H', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/I', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/J', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/K', false, NULL, NULL, NULL),
  ('Locker 02 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 02', 'Locker 02/L', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/A', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/B', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/C', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/D', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/E', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/F', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/G', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/H', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/I', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/J', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/K', false, NULL, NULL, NULL),
  ('Locker 03 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 03', 'Locker 03/L', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/A', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/B', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/C', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/D', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/E', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/F', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/G', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/H', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/I', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/J', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/K', false, NULL, NULL, NULL),
  ('Locker 04 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 04', 'Locker 04/L', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/A', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/B', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/C', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/D', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/E', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/F', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/G', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/H', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/I', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/J', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/K', false, NULL, NULL, NULL),
  ('Locker 05 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 05', 'Locker 05/L', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/A', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/B', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/C', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/D', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/E', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/F', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/G', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/H', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/I', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/J', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/K', false, NULL, NULL, NULL),
  ('Locker 06 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 06', 'Locker 06/L', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/A', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/B', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/C', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/D', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/E', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/F', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/G', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/H', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/I', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/J', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/K', false, NULL, NULL, NULL),
  ('Locker 07 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 07', 'Locker 07/L', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/A', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/B', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/C', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/D', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/E', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/F', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/G', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/H', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/I', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/J', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/K', false, NULL, NULL, NULL),
  ('Locker 08 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 08', 'Locker 08/L', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/A', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/B', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/C', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/D', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/E', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/F', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/G', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/H', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/I', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/J', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/K', false, NULL, NULL, NULL),
  ('Locker 09 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 09', 'Locker 09/L', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/A', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/B', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/C', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/D', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/E', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/F', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/G', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/H', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/I', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/J', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/K', false, NULL, NULL, NULL),
  ('Locker 10 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 10', 'Locker 10/L', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/A', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/B', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/C', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/D', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/E', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/F', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/G', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/H', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/I', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/J', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/K', false, NULL, NULL, NULL),
  ('Locker 11 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 11', 'Locker 11/L', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/A', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/B', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/C', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/D', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/E', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/F', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/G', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/H', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/I', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/J', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/K', false, NULL, NULL, NULL),
  ('Locker 12 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 12', 'Locker 12/L', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/A', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/B', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/C', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/D', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/E', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/F', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/G', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/H', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/I', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/J', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/K', false, NULL, NULL, NULL),
  ('Locker 13 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 13', 'Locker 13/L', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/A', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/B', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/C', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/D', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/E', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/F', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/G', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/H', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/I', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/J', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/K', false, NULL, NULL, NULL),
  ('Locker 14 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 14', 'Locker 14/L', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/A', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/B', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/C', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/D', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/E', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/F', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/G', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/H', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/I', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/J', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/K', false, NULL, NULL, NULL),
  ('Locker 15 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 15', 'Locker 15/L', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/A', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/B', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/C', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/D', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/E', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/F', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/G', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/H', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/I', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/J', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/K', false, NULL, NULL, NULL),
  ('Locker 16 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 16', 'Locker 16/L', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/A', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/B', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/C', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/D', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/E', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/F', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/G', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/H', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/I', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/J', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/K', false, NULL, NULL, NULL),
  ('Locker 17 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 17', 'Locker 17/L', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet A', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/A', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet B', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/B', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet C', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/C', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet D', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/D', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet E', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/E', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet F', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/F', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet G', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/G', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet H', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/H', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet I', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/I', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet J', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/J', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet K', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/K', false, NULL, NULL, NULL),
  ('Locker 18 - Helmet L', 'locker_helmets', 'Green', '2036-03-01', 0, 200, 'IN', 'Locker 18', 'Locker 18/L', false, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────
-- T5. Replace single visitor helmet row with 3 individual rows
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.gear WHERE gear_id = 622;
INSERT INTO public.gear (item, category_id, status, expiry, number_of_uses, usage_limit, signed_in_out, location, physical_serial, is_pool_bucket, pool_count, pool_capacity, set_size)
VALUES
  ('High Rope Visitor Helmet 1', 'hr_helmets', 'Green', '2036-04-30', 0, 200, 'IN', 'High Ropes Shed', 'HR-VH-01', false, NULL, NULL, NULL),
  ('High Rope Visitor Helmet 2', 'hr_helmets', 'Green', '2036-04-30', 0, 200, 'IN', 'High Ropes Shed', 'HR-VH-02', false, NULL, NULL, NULL),
  ('High Rope Visitor Helmet 3', 'hr_helmets', 'Green', '2036-04-30', 0, 200, 'IN', 'High Ropes Shed', 'HR-VH-03', false, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────
-- T6. Add a 2nd general dry bag for lockers 12-18 (one extra each)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.gear (item, category_id, status, expiry, number_of_uses, usage_limit, signed_in_out, location, physical_serial, is_pool_bucket, pool_count, pool_capacity, set_size)
VALUES
  ('Locker 12 Dry Bag 2', 'locker_dry_bags', 'Green', NULL, 0, 200, 'IN', 'Locker 12', 'Locker 12-DB2', false, NULL, NULL, NULL),
  ('Locker 13 Dry Bag 2', 'locker_dry_bags', 'Green', NULL, 0, 200, 'IN', 'Locker 13', 'Locker 13-DB2', false, NULL, NULL, NULL),
  ('Locker 14 Dry Bag 2', 'locker_dry_bags', 'Green', NULL, 0, 200, 'IN', 'Locker 14', 'Locker 14-DB2', false, NULL, NULL, NULL),
  ('Locker 15 Dry Bag 2', 'locker_dry_bags', 'Green', NULL, 0, 200, 'IN', 'Locker 15', 'Locker 15-DB2', false, NULL, NULL, NULL),
  ('Locker 16 Dry Bag 2', 'locker_dry_bags', 'Green', NULL, 0, 200, 'IN', 'Locker 16', 'Locker 16-DB2', false, NULL, NULL, NULL),
  ('Locker 17 Dry Bag 2', 'locker_dry_bags', 'Green', NULL, 0, 200, 'IN', 'Locker 17', 'Locker 17-DB2', false, NULL, NULL, NULL),
  ('Locker 18 Dry Bag 2', 'locker_dry_bags', 'Green', NULL, 0, 200, 'IN', 'Locker 18', 'Locker 18-DB2', false, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────
-- T8. Set whitewater kayaks (missing location) to 'Cage Yardside'
-- ─────────────────────────────────────────────────────────────
UPDATE public.gear SET location = 'Cage Yardside' WHERE gear_id IN (1234,1235,1236,1237,1238,1239,1240,1241,1242,1243,1244,1245,1246,1247,1248,1249,1250,1251,1252,1253,1254,1255,1256,1257,1258);

-- ─────────────────────────────────────────────────────────────
-- T12. Set climbing shoes (cat_climbing_shoes) location to 'Climbing Wall'
-- ─────────────────────────────────────────────────────────────
UPDATE public.gear SET location = 'Climbing Wall' WHERE category_id = 'cat_climbing_shoes';

-- ─────────────────────────────────────────────────────────────
-- T13. Update climbing shoes bucket counts to taxonomy doc values.
--      Bumps capacity if it was below count to satisfy the CHECK constraint.
-- ─────────────────────────────────────────────────────────────
UPDATE public.gear SET pool_count = 1, pool_capacity = GREATEST(pool_capacity, 1) WHERE gear_id = 2966;
UPDATE public.gear SET pool_count = 1, pool_capacity = GREATEST(pool_capacity, 1) WHERE gear_id = 2967;
UPDATE public.gear SET pool_count = 5, pool_capacity = GREATEST(pool_capacity, 5) WHERE gear_id = 2968;
UPDATE public.gear SET pool_count = 5, pool_capacity = GREATEST(pool_capacity, 5) WHERE gear_id = 2969;
UPDATE public.gear SET pool_count = 6, pool_capacity = GREATEST(pool_capacity, 6) WHERE gear_id = 2970;
UPDATE public.gear SET pool_count = 5, pool_capacity = GREATEST(pool_capacity, 5) WHERE gear_id = 2971;
UPDATE public.gear SET pool_count = 5, pool_capacity = GREATEST(pool_capacity, 5) WHERE gear_id = 2972;
UPDATE public.gear SET pool_count = 5, pool_capacity = GREATEST(pool_capacity, 5) WHERE gear_id = 2973;
UPDATE public.gear SET pool_count = 3, pool_capacity = GREATEST(pool_capacity, 3) WHERE gear_id = 2974;
UPDATE public.gear SET pool_count = 2, pool_capacity = GREATEST(pool_capacity, 2) WHERE gear_id = 2975;

-- ─────────────────────────────────────────────────────────────
-- T14. Caving jackets — set 2XL count to 0; add 3XL (count 1, capacity 1)
-- ─────────────────────────────────────────────────────────────
UPDATE public.gear SET pool_count = 0 WHERE gear_id = 2981;
INSERT INTO public.gear (item, category_id, status, signed_in_out, size, is_pool_bucket, pool_count, pool_capacity, location)
VALUES ('Caving Jackets — 3XL', 'cat_caving_jackets', 'Green', 'IN', '3XL', true, 1, 1, 'Resource Centre Clothes Rack');

-- ─────────────────────────────────────────────────────────────
-- T16. Insert 269 new gear rows from taxonomy doc (confident matches only)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.gear (item, category_id, status, expiry, number_of_uses, usage_limit, signed_in_out, location, physical_serial, notes, is_pool_bucket, pool_count, pool_capacity, set_size)
VALUES
  ('Pool Maverick #1', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-001', '', false, NULL, NULL, NULL),
  ('Pool Maverick #2', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-002', '', false, NULL, NULL, NULL),
  ('Pool Maverick #3', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-003', '', false, NULL, NULL, NULL),
  ('Pool Maverick #4', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-004', '', false, NULL, NULL, NULL),
  ('Pool Maverick #5', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-005', '', false, NULL, NULL, NULL),
  ('Pool Maverick #6', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-006', '', false, NULL, NULL, NULL),
  ('Pool Maverick #7', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-007', '', false, NULL, NULL, NULL),
  ('Pool Maverick #8', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-008', '', false, NULL, NULL, NULL),
  ('Pool Maverick #9', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-009', '', false, NULL, NULL, NULL),
  ('Pool Maverick #10', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-010', '', false, NULL, NULL, NULL),
  ('Pool Maverick #11', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-011', '', false, NULL, NULL, NULL),
  ('Pool Maverick #12', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-012', '', false, NULL, NULL, NULL),
  ('Pool Maverick #13', 'cat_mavericks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_MAVE-013', '', false, NULL, NULL, NULL),
  ('Pool Canoe', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_CANO-001', '', false, NULL, NULL, NULL),
  ('Pool Sit On Top Large #1', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SIT_-001', 'Large', false, NULL, NULL, NULL),
  ('Pool Sit On Top Large #2', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SIT_-002', 'Large', false, NULL, NULL, NULL),
  ('Pool Sit On Top Large #3', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SIT_-003', 'Large', false, NULL, NULL, NULL),
  ('Pool Sea Kayak Single #1', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SEA_-001', 'Single', false, NULL, NULL, NULL),
  ('Pool Sea Kayak Single #2', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SEA_-002', 'Single', false, NULL, NULL, NULL),
  ('Pool Sea Kayak Single #3', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SEA_-003', 'Single', false, NULL, NULL, NULL),
  ('Pool Sea Kayak Single #4', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SEA_-004', 'Single', false, NULL, NULL, NULL),
  ('Pool Sea Kayak Single #5', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-CAT_SEA_-005', 'Single', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Double', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-001', 'Double rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Small #1', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-002', 'Small rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Small #2', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-003', 'Small rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Small #3', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-004', 'Small rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Small #4', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-005', 'Small rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Small #5', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-006', 'Small rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Large #1', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-007', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Large #2', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-008', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Large #3', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-009', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Large #4', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-010', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Pool Rafting Kayak Large #5', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Pool', 'TX-WHITEWAT-011', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Container 3 Canoe #1', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Container 3', 'TX-CAT_CANO-002', '', false, NULL, NULL, NULL),
  ('Container 3 Canoe #2', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Container 3', 'TX-CAT_CANO-003', '', false, NULL, NULL, NULL),
  ('Container 3 Canoe #3', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Container 3', 'TX-CAT_CANO-004', '', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #1', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-012', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #2', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-013', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #3', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-014', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #4', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-015', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #5', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-016', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #6', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-017', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #7', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-018', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #8', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-019', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #9', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-020', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #10', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-021', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #11', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-022', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #12', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-023', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #13', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-024', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #14', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-025', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #15', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-026', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #16', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-027', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #17', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-028', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #18', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-029', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #19', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-030', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Rafting Kayak Large #20', 'whitewater_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-WHITEWAT-031', 'Large rafting kayak', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Double #1', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-006', 'Double', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Double #2', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-007', 'Double', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Double #3', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-008', 'Double', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Double #4', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-009', 'Double', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Double #5', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-010', 'Double', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Double #6', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-011', 'Double', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Double #7', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-012', 'Double', false, NULL, NULL, NULL),
  ('Cage Yardside Sea Kayak Single', 'cat_sea_kayaks', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-CAT_SEA_-013', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Double #1', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-005', 'Double', false, NULL, NULL, NULL),
  ('Yard Canoe Double #2', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-006', 'Double', false, NULL, NULL, NULL),
  ('Yard Canoe Double #3', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-007', 'Double', false, NULL, NULL, NULL),
  ('Yard Canoe Single #1', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-008', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #2', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-009', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #3', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-010', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #4', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-011', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #5', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-012', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #6', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-013', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #7', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-014', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #8', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-015', 'Single', false, NULL, NULL, NULL),
  ('Yard Canoe Single #9', 'cat_canoes', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-016', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #1', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-004', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #2', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-005', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #3', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-006', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #4', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-007', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #5', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-008', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #6', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-009', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #7', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-010', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #8', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-011', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #9', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-012', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #10', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-013', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #11', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-014', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #12', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-015', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #13', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-016', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #14', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-017', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #15', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-018', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #16', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-019', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #17', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-020', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #18', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-021', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #19', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-022', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #20', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-023', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #21', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-024', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #22', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-025', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #23', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-026', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #24', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-027', 'Single', false, NULL, NULL, NULL),
  ('Cage Sink side Sit On Top Single #25', 'cat_sit_on_tops', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_SIT_-028', 'Single', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #1', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-001', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #2', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-002', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #3', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-003', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #4', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-004', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #5', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-005', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #6', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-006', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #7', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-007', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #8', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-008', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #9', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-009', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #10', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-010', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #11', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-011', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #12', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-012', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #13', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-013', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #14', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-014', '', false, NULL, NULL, NULL),
  ('Cage Yardside Kayak Paddle #15', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Yardside', 'TX-KAYAK_PA-015', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #1', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-016', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #2', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-017', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #3', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-018', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #4', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-019', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #5', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-020', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #6', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-021', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #7', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-022', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #8', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-023', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #9', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-024', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #10', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-025', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #11', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-026', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #12', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-027', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #13', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-028', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #14', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-029', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #15', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-030', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #16', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-031', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #17', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-032', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #18', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-033', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #19', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-034', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #20', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-035', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #21', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-036', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #22', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-037', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #23', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-038', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #24', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-039', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #25', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-040', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #26', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-041', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #27', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-042', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #28', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-043', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #29', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-044', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #30', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-045', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #31', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-046', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #32', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-047', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #33', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-048', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #34', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-049', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #35', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-050', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #36', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-051', '', false, NULL, NULL, NULL),
  ('Cage Sink side Kayak Paddle #37', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-KAYAK_PA-052', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #1', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-001', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #2', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-002', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #3', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-003', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #4', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-004', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #5', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-005', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #6', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-006', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #7', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-007', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #8', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-008', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #9', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-009', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #10', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-010', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #11', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-011', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #12', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-012', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #13', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-013', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #14', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-014', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #15', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-015', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #16', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-016', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #17', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-017', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #18', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-018', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #19', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-019', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #20', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-020', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #21', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-021', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #22', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-022', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #23', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-023', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #24', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-024', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #25', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-025', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #26', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-026', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #27', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-027', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #28', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-028', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #29', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-029', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #30', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-030', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #31', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-031', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #32', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-032', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #33', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-033', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Paddle #34', 'canoe_paddles', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CANOE_PA-034', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #1', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-053', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #2', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-054', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #3', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-055', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #4', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-056', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #5', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-057', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #6', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-058', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #7', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-059', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #8', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-060', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #9', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-061', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #10', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-062', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #11', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-063', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #12', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-064', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #13', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-065', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #14', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-066', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #15', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-067', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #16', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-068', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #17', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-069', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #18', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-070', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #19', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-071', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #20', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-072', '', false, NULL, NULL, NULL),
  ('Tech Container 5 Kayak Paddle #21', 'kayak_paddles', 'Green', NULL, 0, 200, 'IN', 'Tech Container 5', 'TX-KAYAK_PA-073', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Rack Beam #1', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_CANO-001', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Rack Beam #2', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_CANO-002', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Rack Beam #3', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_CANO-003', '', false, NULL, NULL, NULL),
  ('Cage Sink side Canoe Rack Beam #4', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Cage Sink side', 'TX-CAT_CANO-004', '', false, NULL, NULL, NULL),
  ('Yard Canoe Rack Beam #1', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-005', '', false, NULL, NULL, NULL),
  ('Yard Canoe Rack Beam #2', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-006', '', false, NULL, NULL, NULL),
  ('Yard Canoe Rack Beam #3', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-007', '', false, NULL, NULL, NULL),
  ('Yard Canoe Rack Beam #4', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-008', '', false, NULL, NULL, NULL),
  ('Yard Canoe Rack Beam #5', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-009', '', false, NULL, NULL, NULL),
  ('Yard Canoe Rack Beam #6', 'cat_canoe_rack_beams', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_CANO-010', '', false, NULL, NULL, NULL),
  ('Yard Tarp Thick Blue #1', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-001', 'Thick blue tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Thick Blue #2', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-002', 'Thick blue tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Thick Blue #3', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-003', 'Thick blue tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Thick Blue #4', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-004', 'Thick blue tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #1', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-005', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #2', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-006', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #3', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-007', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #4', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-008', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #5', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-009', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #6', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-010', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #7', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-011', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Tarp Green #8', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-012', 'Green tarp', false, NULL, NULL, NULL),
  ('Yard Fly Blue Orange #1', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-013', 'Blue and orange fly', false, NULL, NULL, NULL),
  ('Yard Fly Blue Orange #2', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-014', 'Blue and orange fly', false, NULL, NULL, NULL),
  ('Yard Fly Blue Orange #3', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-015', 'Blue and orange fly', false, NULL, NULL, NULL),
  ('Yard Fly Blue Orange #4', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-016', 'Blue and orange fly', false, NULL, NULL, NULL),
  ('Yard Fly Blue Orange #5', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-017', 'Blue and orange fly', false, NULL, NULL, NULL),
  ('Yard Fly Blue Brown #1', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-018', 'Blue and brown fly', false, NULL, NULL, NULL),
  ('Yard Fly Blue Brown #2', 'cat_tarps', 'Green', NULL, 0, 200, 'IN', 'Yard', 'TX-CAT_TARP-019', 'Blue and brown fly', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #1', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-001', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #2', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-002', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #3', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-003', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #4', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-004', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #5', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-005', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #6', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-006', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #7', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-007', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #8', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-008', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #9', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-009', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #10', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-010', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #11', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-011', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #12', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-012', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #13', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-013', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #14', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-014', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #15', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-015', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #16', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-016', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #17', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-017', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #18', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-018', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #19', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-019', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Old Small Helmet #20', 'cr_helmets', 'Green', '2027-04-30', 0, 200, 'IN', 'Climbing Wall', 'TX-CR_HELME-020', 'Old small helmet, 1yr expiry', false, NULL, NULL, NULL),
  ('Climbing Wall Rope #1', 'dynamic_ropes', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-DYNAMIC_-001', 'Climbing wall rope', false, NULL, NULL, NULL),
  ('Climbing Wall Rope #2', 'dynamic_ropes', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-DYNAMIC_-002', 'Climbing wall rope', false, NULL, NULL, NULL),
  ('Climbing Wall Rope #3', 'dynamic_ropes', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-DYNAMIC_-003', 'Climbing wall rope', false, NULL, NULL, NULL),
  ('Climbing Wall Rope #4', 'dynamic_ropes', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-DYNAMIC_-004', 'Climbing wall rope', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #1', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-001', 'Climbing wall mat', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #2', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-002', 'Climbing wall mat', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #3', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-003', 'Climbing wall mat', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #4', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-004', 'Climbing wall mat', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #5', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-005', 'Climbing wall mat', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #6', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-006', 'Climbing wall mat', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #7', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-007', 'Climbing wall mat', false, NULL, NULL, NULL),
  ('Climbing Wall Mat #8', 'cat_roll_mats', 'Green', NULL, 0, 200, 'IN', 'Climbing Wall', 'TX-CAT_ROLL-008', 'Climbing wall mat', false, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────
-- T7. Student shovels — convert to 3 set-marker rows + 3 lists × 4 individuals
-- T17. Create 6 trad rack lists (one per rack) + 3 student shovel lists
-- ─────────────────────────────────────────────────────────────
-- First: convert existing student shovels to set markers (set_size=4).
UPDATE public.gear SET set_size = 4 WHERE gear_id IN (1073, 1074, 1075);

-- Insert 12 individual shovel rows (4 per colour) — these go INTO the lists.
INSERT INTO public.gear (item, category_id, status, expiry, number_of_uses, usage_limit, signed_in_out, location, physical_serial, is_pool_bucket, pool_count, pool_capacity, set_size)
VALUES
  ('Climbing Room Student Shovel Yellow #1', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-Y1', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Yellow #2', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-Y2', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Yellow #3', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-Y3', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Yellow #4', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-Y4', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Green #1', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-G1', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Green #2', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-G2', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Green #3', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-G3', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Green #4', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-G4', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Blue #1', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-B1', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Blue #2', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-B2', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Blue #3', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-B3', false, NULL, NULL, NULL),
  ('Climbing Room Student Shovel Blue #4', 'snow_shovels', 'Green', NULL, 0, 200, 'IN', 'Climbing Room', 'CR-SHOV-B4', false, NULL, NULL, NULL);

-- Create the 9 lists (6 trad rack + 3 shovel sets).
INSERT INTO public.lists (list_id, name, description, behaviour) VALUES
  ('lst_trad_yellow', 'Trad Rack Yellow', 'Auto-built — 44 items per rack', 'signable'),
  ('lst_trad_red', 'Trad Rack Red', 'Auto-built — 44 items per rack', 'signable'),
  ('lst_trad_green', 'Trad Rack Green', 'Auto-built — 44 items per rack', 'signable'),
  ('lst_trad_white', 'Trad Rack White', 'Auto-built — 44 items per rack', 'signable'),
  ('lst_trad_blue', 'Trad Rack Blue', 'Auto-built — 44 items per rack', 'signable'),
  ('lst_trad_yellowgreen', 'Trad Rack Yellow-Green', 'Auto-built — 44 items per rack', 'signable'),
  ('lst_shovel_yellow', 'Student Shovel Set Yellow', 'Auto-built — 4 shovels', 'signable'),
  ('lst_shovel_green', 'Student Shovel Set Green', 'Auto-built — 4 shovels', 'signable'),
  ('lst_shovel_blue', 'Student Shovel Set Blue', 'Auto-built — 4 shovels', 'signable')
ON CONFLICT (list_id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, behaviour = EXCLUDED.behaviour;

-- Link list_gear members. We use serial-based lookups so this works regardless
-- of which gear_ids the database assigned to the new rows.

-- Trad racks:
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_trad_yellow', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'TR-Yellow-%';
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_trad_red', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'TR-Red-%';
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_trad_green', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'TR-Green-%';
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_trad_white', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'TR-White-%';
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_trad_blue', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'TR-Blue-%';
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_trad_yellowgreen', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'TR-YellowGreen-%';

-- Student shovels:
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_shovel_yellow', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'CR-SHOV-Y%';
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_shovel_green', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'CR-SHOV-G%';
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
  SELECT 'lst_shovel_blue', g.gear_id, ROW_NUMBER() OVER (ORDER BY g.physical_serial)
  FROM public.gear g WHERE g.physical_serial LIKE 'CR-SHOV-B%';

-- ─────────────────────────────────────────────────────────────
-- T18. Build 18 locker lists, one per locker, behaviour=monitored_only
--      Each list contains every gear row currently at that locker location
--      whose category begins with 'locker_' or is 'biolites'.
--      Re-running this is safe: existing lists are upserted, list_gear is
--      replaced (delete + re-insert).
-- ─────────────────────────────────────────────────────────────

-- Insert / upsert 18 locker lists
INSERT INTO public.lists (list_id, name, description, behaviour) VALUES
  ('lst_locker_01', 'Locker 01', 'All gear in Locker 01 — auto-built', 'monitored_only'),
  ('lst_locker_02', 'Locker 02', 'All gear in Locker 02 — auto-built', 'monitored_only'),
  ('lst_locker_03', 'Locker 03', 'All gear in Locker 03 — auto-built', 'monitored_only'),
  ('lst_locker_04', 'Locker 04', 'All gear in Locker 04 — auto-built', 'monitored_only'),
  ('lst_locker_05', 'Locker 05', 'All gear in Locker 05 — auto-built', 'monitored_only'),
  ('lst_locker_06', 'Locker 06', 'All gear in Locker 06 — auto-built', 'monitored_only'),
  ('lst_locker_07', 'Locker 07', 'All gear in Locker 07 — auto-built', 'monitored_only'),
  ('lst_locker_08', 'Locker 08', 'All gear in Locker 08 — auto-built', 'monitored_only'),
  ('lst_locker_09', 'Locker 09', 'All gear in Locker 09 — auto-built', 'monitored_only'),
  ('lst_locker_10', 'Locker 10', 'All gear in Locker 10 — auto-built', 'monitored_only'),
  ('lst_locker_11', 'Locker 11', 'All gear in Locker 11 — auto-built', 'monitored_only'),
  ('lst_locker_12', 'Locker 12', 'All gear in Locker 12 — auto-built', 'monitored_only'),
  ('lst_locker_13', 'Locker 13', 'All gear in Locker 13 — auto-built', 'monitored_only'),
  ('lst_locker_14', 'Locker 14', 'All gear in Locker 14 — auto-built', 'monitored_only'),
  ('lst_locker_15', 'Locker 15', 'All gear in Locker 15 — auto-built', 'monitored_only'),
  ('lst_locker_16', 'Locker 16', 'All gear in Locker 16 — auto-built', 'monitored_only'),
  ('lst_locker_17', 'Locker 17', 'All gear in Locker 17 — auto-built', 'monitored_only'),
  ('lst_locker_18', 'Locker 18', 'All gear in Locker 18 — auto-built', 'monitored_only')
ON CONFLICT (list_id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, behaviour = EXCLUDED.behaviour;

-- Wipe existing memberships of these 18 lists so we can rebuild cleanly
DELETE FROM public.list_gear
 WHERE list_id IN (
   'lst_locker_01','lst_locker_02','lst_locker_03','lst_locker_04','lst_locker_05',
   'lst_locker_06','lst_locker_07','lst_locker_08','lst_locker_09','lst_locker_10',
   'lst_locker_11','lst_locker_12','lst_locker_13','lst_locker_14','lst_locker_15',
   'lst_locker_16','lst_locker_17','lst_locker_18'
 );

-- Build memberships: for each locker, find all gear at that location whose
-- category is a locker_* category or 'biolites'. Sort within the list by
-- category then physical_serial for predictable ordering.
INSERT INTO public.list_gear (list_id, gear_id, sort_order)
SELECT
  'lst_locker_' || LPAD(SUBSTRING(g.location FROM 'Locker ([0-9]+)'), 2, '0') AS list_id,
  g.gear_id,
  ROW_NUMBER() OVER (
    PARTITION BY g.location
    ORDER BY g.category_id, g.physical_serial NULLS LAST, g.gear_id
  )::int AS sort_order
FROM public.gear g
WHERE g.location ~ '^Locker [0-9]+$'
  AND (g.category_id LIKE 'locker_%' OR g.category_id = 'biolites');


-- Restore normal replication mode (re-arms triggers).
SET session_replication_role = 'origin';

COMMIT;


-- ─────────────────────────────────────────────────────────────
-- Verification queries (run individually, NOT in the migration)
-- ─────────────────────────────────────────────────────────────
-- SELECT category_id, COUNT(*) FROM public.gear
--  WHERE category_id IN ('belay_devices','cat_atcs','cat_atc_guide','cat_figure_8','cat_gri_gri')
--  GROUP BY category_id;
-- SELECT COUNT(*) trad_rows FROM public.gear WHERE category_id='camming_devices' AND item ILIKE '%trad rack%';  -- 264
-- SELECT COUNT(*) helmet_rows FROM public.gear WHERE category_id='locker_helmets';                              -- 216
-- SELECT category_id, COUNT(*) FROM public.gear
--  WHERE category_id IN ('cat_alloy_carabiners','cat_steel_carabiners','carabiners')
--  GROUP BY category_id;
-- Locker list sizes (expect ~88-100 each):
-- SELECT l.list_id, l.name, COUNT(lg.gear_id) members
--   FROM public.lists l LEFT JOIN public.list_gear lg ON lg.list_id = l.list_id
--   WHERE l.list_id LIKE 'lst_locker_%' GROUP BY l.list_id, l.name ORDER BY l.list_id;
