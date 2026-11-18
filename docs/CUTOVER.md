# Cutover: from the Obsidian vault to Taskplus

Goal: run both side by side for about two weeks, confirm Taskplus agrees with the vault, then switch off the
Windows scheduled tasks. Nothing here deletes the vault; it can stay as plain notes.

## Before you start (one time)

Finish `docs/SETUP-moodle-worker.md`: KV, `TOKEN_ENC_KEY`, optionally `ANTHROPIC_API_KEY` and
`FCM_SERVICE_ACCOUNT`. Then in the app: Settings > Connect Moodle, pick courses, turn on notification
permission and send a test alert. Type each course's class times on its Course detail screen. Taskplus has no
grades (Moodle stays the place for those), so the vault's grade views are not replaced.

## Each week of the overlap

Export Settings > Export > Backup, then compare:

```bash
node tools/compare-vault.mjs "<vault path>" taskplus-backup.json
```

It lists what is only in the vault, only in Taskplus, and where due dates or status differ. Finished and old
notes are skipped (add `--all` to include them). Expect these, and decide each:
- **No Moodle link** (the CSCI course site, manual items): Taskplus has no CSCI importer yet (Phase 6, not
  built). Keep adding those by hand, or keep the vault's CSCI task until the importer exists.
- **Due differs** after a teacher moves a date: the newer one wins. Check the What's new feed shows the change.
- **Status differs**: Taskplus reads Moodle's submission state; the vault status was typed by hand.

## Ready to switch off the scheduled tasks when

- [ ] Two weeks with nothing unexplained in the comparison.
- [ ] You acted on at least one alert from your phone (new assignment or due soon) while the app was closed.
- [ ] Every assignment you care about, with its due date, shows up in Taskplus (the comparison above).
- [ ] You do not need the pieces Taskplus does not replace yet: flashcards, lecture notes, the CSCI site
      importer, scheduled backups (Phase 6 leftovers). If you do, keep those parts of the vault running.

## Then

1. Disable the Windows scheduled Moodle sync task (keep the script; do not delete it for a month).
2. Keep a vault copy. The last vault backup is your rollback.
3. Revisit merging this repo into production (`AGENTS.md`: do not carry over `wrangler.toml`'s `[[routes]]`).

## Rollback

Taskplus never writes to the vault or to Moodle. To go back, re-enable the scheduled task. Disconnecting
Moodle in Settings deletes the stored token and the alert snapshot.
