# How to back up your database — the human version

Time required: 15 minutes for first-time setup, then 30 seconds every time
after that.

You don't need to be technical. You need to:
1. Open a black-and-white text window on your computer
2. Type a command
3. Press Enter
4. A backup file appears on your Desktop

That's it. Below is exactly which buttons to click, what to type, and what
to expect.

---

## STEP 1 — Are you on Mac or Windows?

The steps differ slightly. Skip to the right section.

- **Mac users**: keep reading
- **Windows users**: scroll down to "WINDOWS INSTRUCTIONS"

---

# MAC INSTRUCTIONS

## STEP 2 (Mac) — Install pg_dump (the backup tool)

You only do this ONCE, ever.

1. Open the **Terminal** app. To find it:
   - Press `Cmd + Space` (this opens Spotlight search)
   - Type `terminal`
   - Press Enter
   - A black or white window opens with text in it. That's Terminal.

2. In that window, paste this exact command and press Enter:
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   This installs "Homebrew" — a tool that installs other tools. It will ask
   for your Mac password (you won't see characters as you type — just type
   it and press Enter). It takes 5–10 minutes. Lots of text scrolls past.
   That's normal.

3. When it finishes (you get a fresh prompt back), paste this and press Enter:
   ```
   brew install postgresql@16
   ```
   Takes another 2–3 minutes.

4. Test it worked. Paste this and press Enter:
   ```
   pg_dump --version
   ```
   You should see something like `pg_dump (PostgreSQL) 16.4`. If yes, you're
   set. If you see "command not found", paste this and press Enter, then
   try the version command again:
   ```
   echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```

## STEP 3 (Mac) — Get your database connection string

1. Open https://supabase.com in your browser, log in
2. Click your project (Hillary-outdoors)
3. In the left sidebar, click the **gear icon** (Settings) at the bottom
4. Click **Database**
5. Scroll down to "Connection string"
6. There are tabs labelled "URI", "PSQL", "Golang" etc. — click **URI**
7. You'll see something like:
   ```
   postgresql://postgres.boclsssdwwiumkhqnypw:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
   ```
8. Click the **Copy** button next to it
9. Paste it somewhere safe (a notes app, or Word doc) — you'll need it in a
   second.

The `[YOUR-PASSWORD]` placeholder needs to be replaced with your actual
database password. If you don't remember it: on the same Database settings
page, scroll up to "Database Password" → click **Reset database password**
→ copy the new password somewhere safe → use it in the connection string.

So your final string should look like (no square brackets):
```
postgresql://postgres.boclsssdwwiumkhqnypw:hunter2@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

## STEP 4 (Mac) — Take your first backup

Back in Terminal, paste this — but FIRST, replace the connection string at
the end with your real one from Step 3:

```
pg_dump --no-owner --no-privileges --clean --if-exists --schema=public --schema=auth --file="$HOME/Desktop/hillary-backup.sql" "PASTE-YOUR-CONNECTION-STRING-HERE"
```

Press Enter. It runs for about 5–15 seconds (no progress bar — just trust it).
When you get a fresh prompt back with no error, you're done.

Check your Desktop. There should be a file called `hillary-backup.sql` that's
a few megabytes. Open it with TextEdit if you want to confirm — you'll see a
huge file of SQL commands. Don't edit it. Just stash it somewhere safe like
Dropbox or iCloud.

## STEP 5 (Mac) — Make a one-click backup script

You don't want to retype that command every time. Let's make a click-to-run
backup.

1. Open the **TextEdit** app (Spotlight → "textedit")
2. **VERY IMPORTANT**: at the top, click Format → **Make Plain Text**
   (otherwise the file won't work)
3. Paste this, with your real connection string in place of the placeholder:
   ```
   #!/bin/bash
   pg_dump --no-owner --no-privileges --clean --if-exists --schema=public --schema=auth --file="$HOME/Desktop/hillary-backup-$(date +%Y%m%d-%H%M).sql" "PASTE-YOUR-CONNECTION-STRING-HERE"
   echo "Backup saved to Desktop"
   read -p "Press Enter to close..."
   ```
4. Save it to your Desktop as `backup-hillary.command` (the `.command`
   extension is what makes it click-to-run)
5. In Finder, find the file on your Desktop. Right-click it → **Open With**
   → **Other** → tick "Always Open With" → choose **Terminal** → **Open**
6. (One-time-only) make it executable: back in Terminal, paste:
   ```
   chmod +x ~/Desktop/backup-hillary.command
   ```

Now any time you want a backup: **double-click `backup-hillary.command` on
your Desktop**. A Terminal window opens, runs the backup, says "Backup
saved", and you press Enter to close it. A new file like
`hillary-backup-20260430-2145.sql` appears on your Desktop.

That's the whole loop: double-click → wait 15 seconds → press Enter → done.

---

# WINDOWS INSTRUCTIONS

## STEP 2 (Windows) — Install pg_dump

1. Go to https://www.postgresql.org/download/windows/ in your browser
2. Click "Download the installer" — opens a EnterpriseDB page
3. Download the latest version (16.x or 17.x). It's about 350 MB.
4. Run the installer. When it asks what to install, **untick** every box
   EXCEPT "Command Line Tools". Click Next through everything. Set a
   password if it asks (you won't actually use it for backups — just any
   password is fine).
5. After install: open the **Start menu**, search for "Environment Variables"
   → click **Edit the system environment variables** → in the dialog, click
   **Environment Variables** button → in the lower box, find **Path** → click
   **Edit** → click **New** → paste:
   ```
   C:\Program Files\PostgreSQL\16\bin
   ```
   (change `16` to whichever version you installed). Click OK on everything.
6. Open **PowerShell** (Start menu → search "powershell" → click it)
7. Paste and Enter:
   ```
   pg_dump --version
   ```
   Should print `pg_dump (PostgreSQL) 16.x`. If it says "not recognized",
   close PowerShell and reopen — environment variable changes only take
   effect in newly-opened windows.

## STEP 3 (Windows) — Get your connection string

Same as Mac STEP 3 — go to Supabase → Settings → Database → URI tab → copy.

## STEP 4 (Windows) — Take your first backup

In PowerShell, paste this with your real connection string at the end:

```
pg_dump --no-owner --no-privileges --clean --if-exists --schema=public --schema=auth --file="$env:USERPROFILE\Desktop\hillary-backup.sql" "PASTE-YOUR-CONNECTION-STRING-HERE"
```

Press Enter. After 5–15 seconds, check your Desktop for `hillary-backup.sql`.

## STEP 5 (Windows) — One-click backup script

1. Open **Notepad** (Start menu → "notepad")
2. Paste this, with your real connection string:
   ```
   pg_dump --no-owner --no-privileges --clean --if-exists --schema=public --schema=auth --file="%USERPROFILE%\Desktop\hillary-backup-%date:~10,4%%date:~4,2%%date:~7,2%-%time:~0,2%%time:~3,2%.sql" "PASTE-YOUR-CONNECTION-STRING-HERE"
   echo Backup saved to Desktop
   pause
   ```
3. Save As → save type **All Files** → name it `backup-hillary.bat` → put
   on Desktop

Double-click `backup-hillary.bat` whenever you want a backup. A black
window opens, runs, prints "Press any key to continue", you do, done.

---

# IF SOMETHING GOES WRONG

## "command not found" / "not recognized"
The PATH variable isn't set up. On Mac, paste this and try again:
```
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
```
On Windows, you missed step 5 in the install — go back and add the Path entry.

## "FATAL: password authentication failed"
The connection string has a wrong password. Either you forgot to replace
`[YOUR-PASSWORD]`, or your DB password is different from what you typed.
Reset it on the Supabase Database page.

## "could not translate host name"
You're not connected to the internet, or you copied the connection string
wrong. Re-copy it from Supabase.

## "permission denied for schema public" or empty backup file
You're using the wrong connection string. The "URI" tab is the right one —
not "JDBC", not "PSQL".

## The backup file is tiny (less than 100 KB)
Something failed silently. Open the file in TextEdit — if it has SQL in it,
it might just be a small project. If it's empty, something went wrong above.

## I lost my database password
Supabase → Settings → Database → Reset database password. Note: this only
resets the DB password, not your Supabase login.

---

# HOW TO RESTORE FROM A BACKUP — only do this if disaster strikes

If your Supabase project ever gets wiped or you need to migrate to a new
project:

1. Make a fresh Supabase project
2. Get its connection string the same way as before
3. In Terminal/PowerShell:
   ```
   psql "NEW-PROJECT-CONNECTION-STRING" < ~/Desktop/hillary-backup.sql
   ```
   (use `%USERPROFILE%\Desktop\hillary-backup.sql` on Windows)
4. Wait. Watch lots of "CREATE TABLE", "INSERT 0 1" go past. When it's done,
   you have a clone of your old database in the new project.
5. Update your app's `src/supabase.js` with the new project URL + key, push.

---

# WHAT TO DO RIGHT NOW

If you've never done this before, do this in order:

1. Take 15 minutes, install pg_dump (STEP 2)
2. Get your connection string (STEP 3)
3. Take ONE backup the long way (STEP 4)
4. Verify the file landed on your Desktop and isn't empty
5. Stash it somewhere off your computer (email it to yourself, drop it in
   Dropbox, iCloud, whatever)
6. Make the one-click script (STEP 5)
7. Run the one-click script once a week, or before any big migration

That's it. You're now safe from disaster.
