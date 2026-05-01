# v18.1.1 — same fixes + sequence resync + 18 locker lists

## What's different from v18.1

The previous run hit `duplicate key value violates unique constraint "gear_pkey"`
on `gear_id=2967`. Cause: Postgres serial sequences had drifted behind the
actual MAX(gear_id) — likely from prior CSV imports that included explicit IDs.
When my T16 INSERTs ran without explicit IDs, the sequence handed out 2967 (already taken).

This file:
1. **Pre-flight resync** of all serial sequences to MAX(id) before any inserts.
2. **All v18.1 fixes** (T1–T17) re-run identically.
3. **NEW T18:** 18 locker lists (one per Locker 01–18), each populated with
   every gear row at that locker location whose category is `locker_*` or `biolites`.

## Deploy

1. **Back up** (Supabase → Database → Backups → Manual). Skip if you literally
   just made one for v18.1.
2. **Run `04_data_fixes_v18_1.1.sql`** (NOT the old v18.1 file) in Supabase SQL Editor.
3. **Replace `src/App.jsx`** in your repo (list limit bumped to 150 so the locker
   lists with ~100 items have headroom).
4. **Hard-refresh** the live URL.

## Verification queries — paste these one-by-one to confirm

```sql
-- 1. Belay device split (expect: 3 in belay_devices, 18 atcs, 12 atc_guide, 17 figure_8, 12 gri_gri)
SELECT category_id, COUNT(*)
  FROM public.gear
 WHERE category_id IN ('belay_devices','cat_atcs','cat_atc_guide','cat_figure_8','cat_gri_gri')
 GROUP BY category_id;

-- 2. Trad racks (expect: 264)
SELECT COUNT(*) FROM public.gear
 WHERE category_id='camming_devices' AND item ILIKE '%trad rack%';

-- 3. Locker helmets rebuilt (expect: 216 = 18 × 12)
SELECT COUNT(*) FROM public.gear WHERE category_id='locker_helmets';

-- 4. Carabiner split (expect: ~98 in carabiners, 36 alloy, 4 steel)
SELECT category_id, COUNT(*) FROM public.gear
 WHERE category_id IN ('cat_alloy_carabiners','cat_steel_carabiners','carabiners')
 GROUP BY category_id;

-- 5. Trad rack + shovel lists
SELECT l.list_id, l.name, COUNT(lg.gear_id) AS members
  FROM public.lists l LEFT JOIN public.list_gear lg ON lg.list_id = l.list_id
 WHERE l.list_id LIKE 'lst_trad_%' OR l.list_id LIKE 'lst_shovel_%'
 GROUP BY l.list_id, l.name ORDER BY l.list_id;
-- Expect 6 trad lists × 44 members + 3 shovel lists × 4 members

-- 6. Locker lists (NEW — expect 18 rows, each ~88-100 members)
SELECT l.list_id, l.name, COUNT(lg.gear_id) AS members
  FROM public.lists l LEFT JOIN public.list_gear lg ON lg.list_id = l.list_id
 WHERE l.list_id LIKE 'lst_locker_%'
 GROUP BY l.list_id, l.name ORDER BY l.list_id;
```

## Why locker lists matter

After the migration each locker has roughly: 12 helmets + 7 carabiners + 3 dry
bags + 74 misc + 1 prusik + 1 shelter + 2 slings = ~100 items. Now each one
has a single QR/NFC tag you can scan to bring up the entire locker contents at
once for a check or sign-out. The behaviour is `monitored_only` so it shows up
on a check screen instead of a sign-out screen.

## Known minor issue carried over

There's still 1 `biolite` row at location `'Locker'` (no number) that I can't
auto-assign. Find it in the gear list and edit it to give it a real Locker NN
location, then either re-run T18's INSERT block by itself, or just add it to
the appropriate locker list manually in the app.
