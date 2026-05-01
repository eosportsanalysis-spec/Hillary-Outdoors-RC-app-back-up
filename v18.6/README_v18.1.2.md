# v18.1.2 — Add Gear persistence fix + category-level QR/NFC + backup guide

Three things this round:

## 1. New gear (incl. fuel items) was vanishing on refresh — FIXED

Same family of bug as the categories/locations/lists silent-write issue.
The Add Gear handler was:
1. Pre-allocating gear_id from React state (`maxId+1`)
2. Inserting into local state
3. Trying to write to DB
4. Silently swallowing any error

When the Postgres serial sequence drifted past the React-allocated ID, the
DB rejected the insert — but the catch was empty so the row stayed in React
state until refresh. Same pattern that broke categories before.

**Fix:** Add Gear now lets the DB allocate `gear_id`, only adds rows to
React state if the DB accepted them, and toasts a clear error if any failed.

## 2. Category-level QR/NFC tags — NEW FEATURE

You can now attach a single QR or NFC tag to an entire category. For sized
pools (fleeces, PFDs etc), scanning that one tag opens the size grid where
you can sign out 2L + 5M + 3XS in one flow.

Two layers needed:
1. **`05_category_qr_nfc.sql`** — adds `nfc_tag` and `qr_code` columns to
   the `categories` table with unique constraints. Run this in Supabase SQL
   editor before the new App.jsx hits production.
2. **App.jsx** — Categories tab edit modal now has Scan NFC / Scan QR
   buttons; tag-scan resolution checks gear → list → category in that order.

You can still tag individual bucket rows the old way (each bucket is a gear
row with its own `nfc_tag`/`qr_code`) — useful if you want a separate QR
per size. Both work side by side.

## 3. Disaster-recovery guide — `BACKUP_GUIDE.md`

Free-tier Supabase has no automated backups. This guide walks through doing
a complete `pg_dump` to your own machine in 30 seconds, plus how to restore
to a fresh Supabase project if anything ever gets wiped.

## Deploy order

1. Run `05_category_qr_nfc.sql` in Supabase SQL editor.
2. Replace `src/App.jsx` in the repo (GitHub web UI pencil → paste → commit).
3. Hard-refresh the live URL (Ctrl+Shift+R).
4. (Recommended) follow `BACKUP_GUIDE.md` to take your first manual backup.

## Test list — try these after deploy

- Add a fuel item via Add Gear → refresh → should still be there
- Edit a sized_pool category → enter an NFC/QR tag → save → refresh → still set
- (When you have a physical tag) scan a tagged category → should open the size grid
- Add a list with a custom NFC tag → save → close → reopen → tag preserved
- Scan a list NFC tag → should open the list contents (works with real lists now, not just LST001/LST002 test data)
