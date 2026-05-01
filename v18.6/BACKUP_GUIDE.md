# Backup & disaster recovery — Supabase free tier

Supabase free tier doesn't ship automated backups. You're on your own. Good
news: it takes 30 seconds and one command.

## What you need

- The `pg_dump` binary (comes free with any Postgres install: `brew install postgresql` on Mac, `apt install postgresql-client` on Ubuntu/WSL, `choco install postgresql` on Windows). You don't need to RUN postgres — just the client tools.
- Your Supabase database connection string. Get it from:

  Supabase Dashboard → Project Settings → Database → **Connection string** → **URI**

  It looks like:
  ```
  postgresql://postgres.xxxxxxxxxxxxxxxxxx:YOUR_DB_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
  ```
  You'll be prompted for your DB password the first time — save it somewhere.

## A complete backup, in one command

```bash
pg_dump \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --schema=public \
  --schema=auth \
  --file="hillary-backup-$(date +%Y%m%d-%H%M%S).sql" \
  "postgresql://postgres.YOURREF:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
```

You'll get `hillary-backup-20260430-143000.sql` (or similar) — a single text
file containing every table definition and every row of data. Mine for you
right now would be roughly 3 MB.

**Stash this somewhere safe** — Dropbox, iCloud, GitHub private repo, USB
stick, whatever. I'd run this once a week minimum during the data-cleanup
phase, less often once you're stable.

### Just data, no schema

If you only want the rows (not table definitions, useful for migrating data
into an already-set-up Supabase):
```bash
pg_dump --data-only --no-owner --schema=public ... "$URI"
```

### Just schema, no data

```bash
pg_dump --schema-only --no-owner --schema=public ... "$URI"
```

## How to restore (full disaster recovery)

If a Supabase project ever gets wiped, deleted, or corrupted:

1. Create a fresh Supabase project (free tier is fine).
2. Update your app's `src/supabase.js` with the new project's URL + anon key.
3. Get the new project's connection string.
4. Restore from your backup:

```bash
psql "postgresql://postgres.NEWREF:NEW_PASSWORD@.../postgres" < hillary-backup-20260430-143000.sql
```

That's it. Schema + data come back exactly as they were at backup time. Auth
users in the `auth` schema also restore (so existing logins work). RLS
policies, triggers, all of it.

## Lighter-weight option: the app's CSV exports

In the manager dashboard → Exports tab → you can already download CSVs of
gear, categories, usage, reports, etc. These are good for spreadsheet work
but they're NOT a complete restore — they don't include lists, list_gear
joins, workflow rows, fuel_log, the new locations table, or the auth.users
table.

If something goes catastrophically wrong and you only have CSVs, restoring is
possible but messy: re-run my migrations, then re-import the CSVs in FK order
(categories → locations → gear → lists → list_gear). You'll lose usage/repair
history.

So: `pg_dump` for safety, CSV exports for spreadsheet analysis.

## A weekly backup batch script (optional)

If you want this to run automatically on your Mac:

```bash
#!/bin/bash
# Save as ~/scripts/hillary-backup.sh, chmod +x, then add to launchd or cron
URI="postgresql://postgres.YOURREF:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
DEST="$HOME/Dropbox/HillaryBackups"
mkdir -p "$DEST"
pg_dump --no-owner --no-privileges --clean --if-exists \
  --schema=public --schema=auth \
  --file="$DEST/hillary-$(date +%Y%m%d).sql" "$URI"
# Keep only last 30 backups
ls -t "$DEST"/hillary-*.sql | tail -n +31 | xargs rm -f
echo "Backup complete: $DEST/hillary-$(date +%Y%m%d).sql"
```

Then on Mac:
```bash
crontab -e
# add this line — runs every Sunday at 3am
0 3 * * 0  /Users/yourname/scripts/hillary-backup.sh
```

## What I'd actually do, in order of paranoia level

| Frequency | Task |
|---|---|
| Once now | First `pg_dump`. Verify the file exists and is non-empty. |
| Weekly during data cleanup | Re-run `pg_dump`, keep last 4 weeks |
| Before any big migration (mine or yours) | Manual `pg_dump` immediately before |
| Eventually, when budget allows | Upgrade to Supabase Pro ($25/mo) — adds daily automated backups + point-in-time recovery |

## If you literally just need a "snapshot now" command

Save this as `backup.sh` somewhere, replace YOUR_PASSWORD and YOURREF:

```bash
#!/bin/bash
pg_dump --no-owner --no-privileges --clean --if-exists \
  --schema=public --schema=auth \
  --file="$HOME/Desktop/hillary-$(date +%Y%m%d-%H%M).sql" \
  "postgresql://postgres.YOURREF:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
echo "Saved to ~/Desktop/hillary-$(date +%Y%m%d-%H%M).sql"
```

Then `bash backup.sh` whenever you want a fresh dump on your desktop.
