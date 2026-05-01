# v18.1.3 — fuel item NOT-NULL fix + sized-pool sign-in/return + damage path

## Three things in this round

### 1. Fuel item couldn't save → fixed
Error you saw: `null value in column "usage_limit" of relation "gear" violates not-null constraint`.
Cause: gear.usage_limit was a NOT NULL column in your DB schema, but fuel items
have no meaningful usage limit, so the form was sending `null` and PG rejected.

Two layers of fix:
- **Schema (`06_nullable_usage_limit.sql`)** drops the NOT NULL constraint —
  `null` now means "no limit", `0` means "untracked", positive = real limit.
- **App (`supabase.js`)** has a new sanitiser that, even for unfixed schemas,
  turns null usage_limit into 0 before sending to PG. Belt-and-braces.

After this update the fuel item, vehicles, and any other NULL-limit gear save
correctly.

### 2. Sized-pool sign-out wasn't returnable → fixed
You signed 5 fleeces out, but they didn't appear in "My Signed-Out Gear", so
no way to sign them back in.

The home screen now lists sized-pool sign-outs in a separate section with two
buttons per row:
- **Sign N Back In** — closes the usage row and increments pool_count back up
  (capped at capacity).
- **Damaged / Lost** — closes the usage row WITHOUT returning items to stock,
  AND reduces pool_capacity by N. Creates a report row for the manager.

### 3. Damage / lost path on the SizedPool screen → NEW
Even without a prior sign-out, an instructor can now report damage directly:
go to the sized pool grid → toggle to "Report Damaged / Lost" mode → pick
quantities → "Report N Damaged / Lost". This drops pool_count AND
pool_capacity by the specified number, and creates a report.

## Deploy

1. Run `06_nullable_usage_limit.sql` in Supabase SQL editor.
2. Replace BOTH `src/App.jsx` and `src/supabase.js` in the repo (the
   sanitiser is in supabase.js so it must come too).
3. Hard-refresh the live URL (Ctrl+Shift+R).

## Test list

- Add a new fuel item → refresh → still there ✓
- Sign out 2 size M fleeces → go home → "My Signed-Out Gear" → see "2 from
  pool · size M" → tap "Sign 2 Back In" → counts increment back ✓
- Sign out 1 size M fleece → go home → tap "Damaged / Lost" → confirm →
  pool_count and pool_capacity both drop by 1 ✓
- Open a sized-pool category from scan → toggle "Report Damaged / Lost"
  mode → pick 1 × XL fleece → "Report 1 Damaged / Lost" → check the
  Reports tab for the new entry ✓

## On the v3 vs v18 title weirdness

Your view-source still showed `v3` despite the v18 code running. Two things:

1. The browser was showing a cached `index.html`. The fix is in DevTools
   → Network tab → tick "Disable cache" → refresh. (You can leave that
   tick on indefinitely while developing — it only applies when DevTools
   is open.)

2. There were two different bundle filenames in your error log
   (`index-DSTNmncZ.js` and `index-BFNNeAbT.js`) which means the browser
   was mixing old cached chunks with new ones. The Disable Cache trick
   handles that too.

After deploying v18.1.3, view-source should say "Hillary Outdoors — Gear
Management v18". If it still says v3, your browser is being stubborn —
try Incognito mode (Cmd+Shift+N or Ctrl+Shift+N) to bypass cache entirely.
