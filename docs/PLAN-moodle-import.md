# Plan — Moodle import, time estimates, and replacing the Obsidian vault

Status: **draft for review. No code written yet.**
Inputs: the user's description, a read-only survey of their vault (Moodle sync
scripts, note schema, dashboards, plugins — secrets redacted), and a read of
this repo (`AGENTS.md`, `js/today-logic.js`, `js/item-logic.js`,
`js/bind-events.js`, `firebase-sync.js`, `functions/index.js`, `wrangler.toml`).

## 1. Goal

Taskplus stops being a place you type assignments into and becomes the whole
study system:

1. **Import** assignments, quizzes, grades and teacher feedback from Moodle
   automatically (replaces `System/moodle/sync_moodle.py` + Windows Task Scheduler).
2. **Estimate** how long each item will take, from its description and metadata.
3. **Plan** each day: use those estimates to decide what work, and which *parts*
   of an assignment, belong on today's list.
4. **Replace the rest of the vault** the web app is better at: reminders and
   push notifications, grade/GPA tracking, class schedule, change feed, and
   later lecture notes and flashcards.

## 2. What already exists (vault side), and what it tells us

The vault's Moodle sync is a Python-stdlib script. It authenticates once with
`login/token.php` (service `moodle_mobile_app`), keeps the token outside the
vault, and then calls `webservice/rest/server.php` with:

| Function | Gives us |
|---|---|
| `core_webservice_get_site_info` | user id |
| `core_enrol_get_users_courses` | courses, filtered by term name |
| `mod_assign_get_assignments` | name, due/open/cutoff dates, points, `intro` (HTML description), attachments |
| `mod_quiz_get_quizzes_by_courses` | open/close, **time limit**, attempts, points, intro |
| `mod_assign_get_submission_status` | submitted / draft / none, teacher feedback |
| `mod_quiz_get_user_attempts` | attempt state |
| `gradereport_user_get_grade_items` | scores, course totals, manual grade items |
| `core_course_get_contents` | weekly sections (schedules) |

Match key between Moodle and a note is the course-module id (`cmid`, from the
`link` URL). Rules worth keeping: never delete, never lower a status, never
overwrite a real score with an empty one, skip files over 25 MB, only the
current term, ignore due dates before term start.

Things in the vault that are **not** Moodle: a CSCI course site scraped with
HTTP Basic auth, hand-entered `weight` per assignment (never synced), class
meeting times parsed from hand-written `Meets:` lines, a hand-typed "Priorities
this week", lecture and topic notes, `Q::A` flashcards (Spaced Repetition
plugin), a weighted-grade/GPA view with per-course scales and a target grade,
a "what changed" feed (`events.json`), and a daily vault backup.

Gaps that matter for this project: the vault stores **descriptions but no
time estimates and no time-spent**; PDF attachments are downloaded but their
text is never read; the daily-notes core plugin is off, so there is no
per-day plan today. Today's "planning" is date sorting.

## 3. Architecture

### 3.1 The Moodle token cannot live in the browser

A browser app can't safely hold a Moodle token, and Moodle's web-service
endpoint generally doesn't send CORS headers for a third-party origin anyway.
So a small server-side piece is required.

**Recommendation: a Cloudflare Worker in this repo**, not Firebase Functions.
Reasons: `wrangler.toml` already deploys a Worker (currently assets only),
CI already deploys it on push to `main`, and `AGENTS.md` says production owns
Firebase Functions deployment and this repo's `functions/` is deliberately
inert. The Worker adds:

- `POST /api/moodle/sync` — run a sync now (called by a "Sync" button).
- A **Cron Trigger** — the replacement for the Windows scheduled task.
- `POST /api/estimate` — the time estimator (section 5).
- Secrets and state in Worker secrets / KV (token, Anthropic API key, per-item
  estimate cache). Every endpoint verifies the caller's **Firebase ID token**
  (JWT check against Google's public keys) so it isn't an open proxy.

`wrangler.toml` will need a `main = "src/worker.js"` entry plus asset-first
routing so static files still serve as they do now. The Worker code should
reuse the repo's dual-environment IIFE module pattern for anything pure
(mapping, estimating), so it stays unit-testable with `node --test`.

### 3.2 Don't let the server write into the existing `data` doc

`firebase-sync.js`'s `push()` does a full `setDoc` of the whole
`users/{uid}/taskplus/data` document. A server writer touching that doc would
be overwritten by the next client push, or would overwrite the client's.

**Use an inbox pattern instead:** the Worker writes normalised Moodle records
to a separate document (e.g. `users/{uid}/taskplus/moodle`), and the *client*
merges them into `items` using the existing merge machinery. Only the client
ever writes `data`.

### 3.3 Firestore size will bite later

All items live in one document (limit 1 MiB). Fine for assignments, **not** for
lecture notes, topics and flashcards. Phase 6 content gets its own
collections (`users/{uid}/notes/*`, `users/{uid}/cards/*`), never `data`.

### 3.4 Beta shares production's Firestore doc

Production's desktop app reads the same `data` doc. New item fields
(`source`, `estimate`, `weight`, ...) must be proven harmless to production's
merge code before they are written there. **Resolved (section 10), as
built in Phase 1:** imported items are kept on the device under their own storage
key and are excluded from what is pushed to the shared `data` doc, so production
never sees them. A beta-only Firestore document (planned as
`users/{uid}/taskplus-beta/*`) is deferred until progress on imported items needs
to sync across devices. Revisit when merging back.

## 4. Data model changes

Today an item is roughly
`{id, title, course, due, total, unit, done, today, notes, subtasks[{text,done}],
dependsOn, recurring, completed, completedAt, createdAt, archived, dailyTarget, updatedAt}`.

Add (all optional, so old items keep working):

```
source:   { type: 'moodle'|'csci'|'manual', cmid, courseId, kind: 'assign'|'quiz'|..., link }
status:   'todo'|'in-progress'|'submitted'|'graded'      // mirrors the vault, derived for non-Moodle items
weight:   number|null     // % of course grade; hand-entered, never overwritten by sync
score:    number|null     // 0-100
opens:    'YYYY-MM-DD'|null   // Moodle "allow submissions from"
estimate: { minutes, low, high, basis: 'quiz-limit'|'heuristic'|'model'|'history'|'user',
            confidence, hash }          // see section 5
spent:    minutes logged so far
```

Steps reuse the existing `subtasks` array, extended to
`{text, done, minutes, day}` so a step can carry its own time and the day it is
planned for. Steps are what Today's "current step" and the detail screen's plan
are built from.

Identity: imported items get a **stable id derived from the source**
(`moodle:<cmid>`), so `itemKey()` dedupes re-imports and two devices never
create twin items. Title/course/due on imported items are sync-owned;
`weight`, `notes`, `estimate` overrides, `subtasks` are user-owned and are
never clobbered by a sync (same philosophy as the vault's "managed block").

`course` stays a plain string per `AGENTS.md`. Moodle course names like
`MATH 2400 ...` map to the existing course entries by code.

## 5. Estimating how long something takes

The model must be honest about uncertainty: output a range and a basis, let
the user override, and improve from actuals.

Layers, applied in order, most trustworthy first:

1. **Known from Moodle.** A quiz's `timelimit` is the estimate (plus a small
   fixed prep factor). Exams likewise.
2. **Heuristic prior** from type, points, submission type (file upload vs
   online text), description length, and per-course history. Cheap, instant,
   works offline, unit-tested.
3. **LLM estimate** via the Worker (`/api/estimate`): input is course, type,
   points, due window, the HTML-to-text description, and later extracted
   attachment text; output is `{minutes, low, high, rationale, suggestedSteps[]}`.
   Cached by a hash of the inputs so a re-sync never re-bills, and a
   description change is the only thing that triggers a new call. The
   Anthropic key lives only in a Worker secret.
4. **Calibration from history (deferred, not in the first version).** Log actual
   time (a simple "I worked N min" on completion, or a start/stop timer). After
   a few items per course/type,
   learn a personal multiplier (`actual / estimated`) and apply it. This is
   what makes the estimator *yours* rather than generic.
5. **User override** always wins and is stored as `basis: 'user'`.

**Showing the range.** The detail screen shows one line, e.g. "About 2h 30m,
likely 2h 15m to 2h 45m". The range is deliberately tight, roughly plus or
minus 10%, once there is evidence behind it (a quiz time limit, or calibration
from history). With little or no history for a course the range is wider, and
the UI should say so, because a tight range with no evidence would be false
precision. Lists (Today, Week) show only the single number ("~50m").

Privacy note: layer 3 sends assignment text (course content, not grades or
credentials) to the Anthropic API. The user should confirm they are fine with
that. Layers 1, 2, 4 work without it.

PDF text extraction is deferred to a later phase; the vault never read PDFs
either, and the descriptions already carry most of the signal.

## 6. Planning today's work with estimates

Current model (`js/today-logic.js`): per-item **unit** counts. `dailyTarget.amt =
ceil(left / daysLeft)`, then bucketed into required-tight / required-pace /
optional / pick. It is deliberately richer than the design doc and must not be
regressed.

New model, added alongside rather than replacing it (feature-flagged until it
beats the old one):

- **No daily limit setting.** Nothing to configure. Today shows the total time
  left, and a day is flagged **heavy** when it is well above the rest of the
  week (a relative comparison, not an absolute cap). A limit can be added later
  if it turns out to be wanted.
- **Minutes, not just units.** For an item with estimate E minutes and `total`
  units, minutes-per-unit = E / total. Single-unit imported assignments get
  **suggested steps** from the estimator (e.g. "read the spec", "write the
  proof", "write-up"), turned into subtasks with their own minutes, so
  "which part of the assignment to do today" has something to point at.
- **Allocation.** Work backward from each due date: remaining minutes spread over
  the available days before due, weighted by `weight` and urgency
  (deadline pressure, then grade weight, then dependency unlocks). Spread the work
  as evenly as the deadlines allow; days that still end up well above the
  week's average are flagged heavy (a one-line nudge on Today, a highlight on
  Week).
- **Today is an open list, not a queue.** All of today's tasks are shown as
  equals so the user can pick whatever they feel like doing; order follows
  deadline pressure but nothing is locked behind anything else. Each row shows
  the current step, due date, a time estimate and a check that completes the
  current step.
- **Output** reuses the existing shape (`targets`, `getAhead`) with minutes
  added, so `today-html.js` changes are additive: a per-row estimate, a header
  total ("2h 30m left today") and the heavy-day flag.
- `dayTarget()/met()` and the `today` counter keep their meaning; day-rollover
  reset is untouched.

This is the one genuinely algorithmic part, so it gets the heaviest unit-test
coverage (pure functions, fixtures of realistic weeks, overload and
no-slack cases).

## 7. Notifications and reminders

The vault has no reminders at all, so this is net-new value. Events from the
Worker sync (the vault's `events.json` model): new assignment, due date moved,
grade posted, feedback posted. Plus time-based: due-soon, "your plan for today
is X minutes", overdue.

**Decision needed**: send these from the Worker (FCM HTTP v1 needs a Firebase
service-account secret in Cloudflare) or extend production's existing hourly
digest function (couples this repo to production's deploy, which `AGENTS.md`
asks us to avoid). Recommendation: Worker.

iOS note: web push only works for a PWA installed to the home screen.

In-app, the same events appear in a **What's new** feed (the bell on Today),
which replaces the vault's `events.json` "recent changes" panel.

## 8. Replacing the rest of the vault (later phases)

In rough priority order, by value over cost:

1. **Grades**: weight, score, per-course letter scale, target grade, weighted
   average and GPA. Port `System/grades/view.js` logic into a pure module with tests.
2. **Class schedule**: meeting times and the weekly schedule, shown on the Week screen.
3. **Change feed**: "what's new" from sync events.
4. **CSCI adapter**: second importer for the non-Moodle course site. Needs its
   own Basic-auth credential stored server-side. Small.
5. **Attachments**: Moodle files into R2 (or just link out); not before needed.
6. **Lecture notes / topic notes**: new collections, markdown editor.
7. **Flashcards / spaced repetition**: SM-2 style scheduler in its own module.
8. **Backups**: Firestore export on a schedule replaces the vault zip.

Not replaced: the Obsidian vault itself can keep existing. This plan makes
the web app the source of truth for *work*; the vault becomes optional notes.

## 9. Screens and navigation

A clickable mockup (sample data only) lives in a private design canvas, not in
this repo; ask the owner for access. It is the visual reference for this section.

**Principle.** The app answers one question: *what should I do today, and how
long will it take?* Moodle is the default source of work, so manual entry, sync
status and source labels stay out of the way.

**Navigation.** Three tabs: **Today, Week, Courses.** The bell (What's new) and
the gear (Settings) sit in Today's header. The old All tab and the large
centre Add button are removed; adding an item by hand is a small "+" in Week's
header. Search and filters are dropped for now.

| Screen | What it shows |
|---|---|
| **Today** | A header summary (total time left, thin progress bar), a one-line heavy-day flag that links to Week, then **all of today's tasks as an open list**: course colour, current step, due date, time estimate, and a check that completes the step. A done row, then Get ahead. |
| **Assignment detail** | Leads with the plan: "About 2h 30m, likely 2h 15m to 2h 45m" with an Edit button, then the steps (check circle, minutes, day). Below that: the Moodle description collapsed with its files, a note row, and the actions "Done with this step" and "Open in Moodle to submit". Due date and weight as chips; a small "From Moodle" tag with no sync time. |
| **Week** | Bars of planned time per day (heavy days highlighted), the selected day's classes and tasks, an overdue row at the top, a Later section for items beyond this week, and the "+" for manual items. |
| **Courses** | Each course's current grade against its target, plus projected GPA. |
| **Course detail** | Grade needed on the remaining weight to hit the target, coming-up items with estimates, graded items, teacher feedback. |
| **Settings** | Moodle status (the only place the last sync time appears), courses to sync, reminders, estimate privacy switches, theme, manage courses and colours. |
| **Connect Moodle** | Moodle address, username, password. The password is used once to get an access token, then discarded. |
| **What's new** | Feed of new items, moved due dates, grades, feedback and re-estimates. |

Code mapping (all additive to the existing view modules): `tabbar-html.js`
becomes three tabs with no Add button; `chrome-html.js` gains the bell and
gear; `all-html.js` is retired and its overdue and later groupings move into
`week-html.js`; `today-html.js` rows gain the step line and estimate;
`settings-html.js` is reworked; new views for assignment detail, courses,
course detail, connect and what's-new. The existing `courses-html.js` (course
names and colours) moves under Settings as "Manage courses". Bump `CACHE_NAME`
in `sw.js` with every change to a precached file.

## 10. Decisions

**Resolved by the user:**
- Audience: mostly the owner; may be shared with others later as a proof of
  concept. Beta only for now. **Mobile app first.** Because others may use it,
  Moodle tokens are stored **per user** in the Worker (never in the browser,
  never returned to the client). The user enters their Moodle address, username
  and password once on an in-app Connect screen; the Worker exchanges them for a
  token (`login/token.php`, as the vault script does), stores only the token, and
  discards the password. The school uses a normal username/password login, so no
  SSO fallback is needed for now.
- Imported items go in a **beta-only** Firestore document, not production's
  shared `data` doc (interpreted from "beta only"; revisit when merging back).
- Sending assignment text to the Anthropic API for estimates: **approved**.
- Everything, including reminders, runs on the **existing Cloudflare Worker**.

- **Capacity:** no daily limit setting. Today shows the total and flags heavy
  days relative to the week.
- **Time logging:** left out of the first version. Calibration from actual
  times (estimating layer 4) comes later.
- **Navigation:** three tabs (Today, Week, Courses); sync time is shown only in
  Settings; manual add is a small "+" on Week.
- **Estimate range:** tight when backed by evidence, wider when there is no
  history (section 5).

The original questions are kept below for reference.

### Original open questions

1. **Single user or multi-user?** If only you, tokens and the API key can be
   plain Worker secrets. If other students might use it, tokens must be stored
   per user, encrypted, with a real onboarding flow.
2. **Where do imported items live?** Same `data` doc as production (shared,
   needs a compatibility check against production's merge code) or a
   beta-only doc (safe, but beta and production stop sharing those items).
3. **Moodle auth.** The vault uses `login/token.php`. If your school moves to SSO
   only, the fallback is the "Security keys" token. Where would you be
   comfortable pasting that token once: a settings screen in the app, or
   `wrangler secret put`?
4. **LLM estimator** okay to send assignment text to the Anthropic API?
5. **Notifications** from the Worker (recommended) or via production's function?
6. **Time logging**: end-of-task "how long did it take?" prompt, or a start/stop
   timer? The prompt is much less friction; the timer is more accurate.
7. **Capacity**: fixed per-weekday minutes you set, or learned from what you
   actually complete?

## 11. Phases

Each phase ships on its own and leaves the app working.

- **Phase 0 — Decisions + safety.** Decisions are in section 10. Confirm the
  beta-only document layout and that the client merges it without touching
  production's `data` doc. Add the redacted Moodle JSON fixtures.
- **Phase 1 — Moodle read-only import. BUILT (see "What Phase 1 shipped").**
  Worker (Firebase sign-in check, encrypted per-user token store,
  username/password token exchange), the Moodle mapping module and client merge,
  the Connect sheet and Settings group with course selection, and the
  three-tab layout (Today, Week, Courses) with Add moved to Week.
  Assignments, quizzes and submission state only.
- **Phase 2 — Weights, grades, status.** Grade items, weight entry, per-course
  scale, the Courses tab and Course detail. One-time import of existing
  `weight`/`target` from the vault via a local Node script that emits JSON for
  you to review.
- **Phase 3 — Minutes-based planning with heuristic estimates.** Estimate
  field, quiz-limit and heuristic layers, the new planner behind a flag, the
  heavy-day flag, Today rows with step and estimate, and the plan-first
  assignment detail screen.
- **Phase 4 — LLM estimates and suggested steps.** `/api/estimate`, caching,
  steps with minutes and days, and range width driven by evidence. Calibration
  from logged time is deferred beyond this phase.
- **Phase 5 — Notifications.** Event detection in sync, FCM delivery, daily
  plan digest.
- **Phase 6 — Vault content.** Schedule, CSCI, lectures, flashcards, backup.
- **Phase 7 — Cutover.** Run both in parallel for a couple of weeks, compare, then
  retire the Windows scheduled tasks.

### What Phase 1 shipped, and where it differs from the plan above

- **Sync is client-triggered, not cron.** The app calls `POST /api/moodle/sync`
  when you tap Sync now, when you sign in, and when it returns to the foreground
  more than 3 hours after the last sync. The Worker returns the records and the
  client merges them. A Worker cron needs a service account to write to
  Firestore, so it moves to Phase 5 with notifications.
- **No inbox document.** For the same reason, the Worker never writes to
  Firestore. Imported items are merged on the device.
- **Imported items stay on the device.** They live under their own localStorage
  key (`tp-moodle-items`) and are filtered out of what `syncPush()` sends, so
  they never reach the shared `data` doc (this is how "beta only" was
  implemented). Consequence: progress on an imported item (checked off, notes,
  steps) is **not** synced between devices yet; each device re-imports from
  Moodle and keeps its own progress. A beta-only Firestore document for imported
  items' progress is the follow-up.
- **Moodle owns** title, course, due date and the `source` details object;
  **the user owns** everything else. The merge never deletes, never un-completes,
  and does not re-add an item the user deleted.
- **`/api/moodle/*`** needs a one-time Cloudflare setup (KV namespace and an
  encryption secret) and answers 503 until then: `docs/SETUP-moodle-worker.md`.
- **Still the old UI under the new nav:** Today and Week are unit-based
  (Phase 3 makes them minutes-based). The All list was kept as a drill-down from
  Week (search, filters, reorder still work) instead of being deleted. The
  Courses tab shows the existing course manager until Phase 2 adds grades.
  The Courses tab reuses the list icon because the icon set has no book icon.
- **Not verified against real services:** a real Moodle site, a real Firebase ID
  token, and a deploy with the KV binding enabled. Everything else is covered by
  unit tests and a jsdom end-to-end run (fake Moodle, real Worker code).

## 12. Testing strategy

- Pure modules (`moodle-map`, `estimate`, `planner`, `grades`) load under
  `node --test` like the existing logic modules, with fixtures captured from
  real, redacted Moodle responses.
- Worker handlers tested with a mocked `fetch`/KV; no real Moodle calls in CI.
- UI behaviour with the disposable jsdom scripts described in `AGENTS.md`;
  visuals via Chromium screenshots; iOS/PWA/push checked on a real device
  (cannot be done from the cloud).
- Dry-run mode for the sync (as the vault script has): show what would change
  before writing.

## 13. Risks

- **School's Moodle terms/rate limits.** A token-based, once-or-twice-daily
  read of your own data via the mobile web-service is the same thing the vault
  already does; keep it that cadence.
- **Merging back to production later.** Beta uses its own Firestore documents
  (3.4), so merging means reconciling them with production's `data` doc and its
  merge code. Plan that migration before merging, not after.
- **Service-worker caching**: every precached-file change must bump `CACHE_NAME`.
- **Estimator trust**: a wrong estimate silently misplans your week. Show the
  basis and range, make override one tap, and don't hide at-risk work.
- **Secrets**: never in the repo, never in logs, never in test fixtures.
