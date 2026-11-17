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
- **Phase 2 — Weights, grades, status. BUILT (see "What Phase 2 shipped").**
  Grade items from Moodle, weight entry, targets and credits, the Courses tab and
  Course detail, and a one-time vault import script that emits JSON for you to
  review.
- **Phase 3 — Minutes-based planning with heuristic estimates. BUILT (see
  "What Phase 3 shipped").** Rule-of-thumb estimates, work split into parts,
  the minutes planner, Today with times and a heavy-day nudge, Week in minutes,
  and the plan-first assignment detail screen.
- **Phase 4 — LLM estimates and suggested steps. BUILT (see "What Phase 4
  shipped").** Claude reads the description, estimates the time and names the
  steps. Calibration from logged time is still deferred.
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

### What Phase 2 shipped

- **Grades come from Moodle's gradebook**, one `gradereport_user_get_grade_items`
  call per selected course (counted in the call budget; they run before the
  per-assignment submission checks). A school that blocks the grade report is a
  warning, not a failed sync: assignments and quizzes still import.
- **A Phase 1 bug fixed on the way:** Moodle's `accessexception` ("this function
  is not enabled for the mobile service") was being treated as an expired
  sign-in, which would have disconnected the user. Only `invalidtoken` does that
  now.
- **The grade math** (`js/grades-logic.js`): current grade = weighted average of
  graded work that has a weight; the part of the 100% with no graded weight is
  "the rest"; needed average on the rest = (target - points earned) / remaining
  weight. If no weights are entered yet it shows Moodle's own course total and
  says so. GPA is credit-weighted on a standard 4.0 table (A 4.0 ... F 0).
- **Weights are entered by the user** per item as a share of the whole course.
  When Moodle's gradebook is flat it also reports its own weights; the detail
  screen offers "Use Moodle's weights" (nested gradebooks are not suggested,
  because there a weight is relative to its category).
- **Targets and credits** default to 90% and 3 credits and are edited with
  steppers on the course screen. A per-course letter scale is supported in the
  data and by the importer, but there is **no editor for it yet**.
- **Everything the user enters is device-local** (`tp-grade-settings`), like
  imported items; Moodle's grades are re-fetched each sync (`tp-moodle-grades`).
- **Navigation:** Courses tab = grades overview; tapping a course opens its
  detail; the old course manager (names, colours) moved to Settings > Manage
  courses.
- **One-time vault import:** `node tools/import-vault-grades.mjs "<vault>" >
  grade-settings.json` (add `--fractions` if weights are written as 0.08). It only
  reads the vault, matches notes to Moodle by the `id=` in their `link:`, and
  prints a report. Review the JSON, then Settings > Import grade settings. Weighted
  notes with no Moodle link (the CSCI course site, manual grade items such as
  attendance) are listed under `report.unlinked` and need their weights entered by
  hand.
- **Not verified:** a real Moodle gradebook (response shapes, hidden grades,
  nested categories), and the vault importer against your real vault: it was
  written from the structure the vault survey described.

### What Phase 3 shipped

- **A rule-of-thumb estimator** (`js/estimate-logic.js`): quizzes use Moodle's time
  limit plus study time; assignments start from points, then adjust for the title
  (exam, writing/project, or light reading/response), description length, a
  handout, and any online-text word limit. Results are rounded to 5 minutes and
  carry a deliberately wide range (about 70% to 150%). **The constants are
  educated guesses, not measurements**; the detail screen says "a rough guess".
  They are the placeholder until Phase 4's LLM read of the description.
- **Parts.** Unfinished imported work is split into roughly 50-minute parts
  (`round(minutes / 50)`, 1 to 8; a quiz is always one part). This sets the item's
  `total` and `unit: 'part'`, so the existing pacing (`ceil(left / days left)`,
  pips, "+1") now runs in real time without being rewritten. Progress is never
  reinterpreted: an item you have already started keeps its parts when its
  estimate changes.
- **Who owns what.** The estimate is recomputed when Moodle's details change,
  except that a number you set yourself (the +/-15m buttons on the detail screen,
  or the Time estimate field on the Add sheet) is never overwritten.
- **The planner** (`js/plan-logic.js`) turns minutes per part into minutes per day
  using the same pacing rules as `today-logic.js` (work days run up to the day
  before the due date; a single-part item is planned for the day before it is
  due; today's share is fixed from the start of the day). This is proven, not
  assumed: tests compare it with the real `today-logic` over ~600 scenarios.
  Today's required minutes plus its get-ahead minutes equal what Week shows for
  today.
- **Today:** "2h 35m left today . 4 tasks" with a thin bar, a per-row estimate,
  "Part 2 of 3" on split work, and a one-line nudge when a later day is heavy
  (a day of at least 90 minutes AND at least 1.5x the week's average).
- **Week:** switches to minutes whenever any open item has an estimate, with a
  "Time left" tile, minute labels, a highlighted heavy day, and a note counting
  items that have no estimate and so are not in the chart.
- **Assignment detail:** opens from a Today row for imported work. Leads with the
  estimate, its range and its reason, the parts (tap the next one to finish it,
  the last finished one to undo), the Moodle description and files, notes, and
  actions. Manual items keep the quick-action menu.

**Where this differs from the plan:**
- **No feature flag.** The plan said to ship the planner behind a flag. Splitting
  work into parts changes the item data, so a flag could not truly turn it off.
  The escape hatch is per item: set the estimate to 75 minutes or less and it is
  one part again (if you have not started it).
- **No named steps yet.** Parts are "Part 1 of 3", not "Read the spec". Suggested,
  named steps come with the LLM estimator in Phase 4.
- **Grade weights do not yet influence the plan** (the plan mentioned weighting by
  grade weight); allocation is by deadline only.
- **The range is wide on purpose** (see section 5): without evidence a tight
  range would be false precision. It narrows only with a quiz time limit, your own
  number, or (later) calibration.
- **Items without an estimate** (manual items you have not given a time) are left
  out of every minutes figure and counted, never silently dropped.
- **Not validated:** the heuristic numbers have not been compared with how long
  your work actually takes. Expect to adjust some; the +/-15m buttons exist for
  that.

### What Phase 4 shipped

- **`POST /api/estimate`** on the Worker (`src/estimate.mjs`, `src/worker.mjs`), using the official Anthropic
  SDK (imported lazily, so the rest of the Worker never loads it). Default model `claude-opus-5-5` with
  `effort: medium`, **structured output** (a closed JSON schema), and the server-side refusal fallback on
  (`fallbacks: "default"`). `ESTIMATE_MODEL` swaps the model.
- **The assignment text is treated as untrusted data:** fenced in `<assignment>` tags with angle brackets
  and control characters stripped, a system prompt that says to ignore instructions inside it, a schema-
  constrained output, and nothing returned is ever used except as numbers and short labels.
- **Everything the model says is validated:** minutes rounded to 5 and clamped to 15-600; the range is forced
  to bracket the estimate (at least +/-15%, at most 2x), so a model that claims false precision is widened;
  step minutes are rescaled to add up to the estimate exactly; at most 8 steps; names cleaned and capped; a
  quiz is never split. An unusable answer is an error and the rule-of-thumb estimate stays.
- **Cost control:** per-user cache keyed on a hash of the inputs (180 days; an unchanged assignment is never
  re-billed), 60 requests per user and 300 overall per day, an optional `ALLOWED_UIDS` allowlist, and a
  required Moodle connection. The Anthropic workspace's own spend limit is the final backstop.
- **Parts follow the steps.** When Claude names the steps, each step is one part and carries its own minutes;
  the planner and Today use the NEXT steps' minutes, not an average. Steps are trusted only while there is
  exactly one per part, so a started item (whose parts cannot change) falls back to the average.
- **Who wins:** your own number always beats Claude. Claude's answer survives a sync until Moodle changes the
  assignment's text, then the rule of thumb takes over until Claude is asked again. Adjusting a Claude
  estimate by hand keeps its step names. "Ask Claude" on the detail screen is the explicit override.
- **Settings > Use Claude to estimate** switches it off (device-local; on by default, per the approval to
  send assignment text).
- **Not verified:** a real call to the live Anthropic API (no key here). What was verified: the real SDK
  puts the intended request on the wire (checked against a local fake server), it bundles and runs inside the
  real Workers runtime, and everything around the call (prompt, validation, cache, limits, errors) is tested
  with a fake client. The quality of the estimates is unmeasured.
- **Handouts (Phase 4b).** With its own Settings switch (on by default) the Worker also downloads the PDFs
  attached to the assignment (`src/handouts.mjs`: up to 2 files of 5 MB, same-site Moodle file URLs only, no
  redirects, `%PDF-` check) and sends them to Claude as document blocks before the text. The prompt asks it to
  use the real question numbers and sections, and to split work over about two hours into 30 to 75 minute
  steps (up to 8). The server, not the model, reports which files were read or skipped and why; the detail
  screen shows it. A temporary download failure is retried (once a day) and its answer is cached for only an
  hour; a lasting one (too big, not a PDF) is final. Existing Claude answers are upgraded once when the switch is
  on, and the cache key includes whether files were read and each file's name, size and modified time, so a
  replaced handout is a new question. Handout reading has its own daily cap (default 20 requests per user).
- **Not read:** Word documents, slides, images, files elsewhere in the course page, and links inside the
  description. These would be a separate step.
- **Still deferred:** calibration from logged time, and sending a course's past actual times as context.

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

## What Phase 5 shipped

- **Change detection** (`src/events.mjs`): each sync becomes a snapshot; diffs give new assignment, moved due
  date (over an hour), grade posted, feedback posted. First sync is a baseline and announces nothing.
- **Feed**: events are stored per user and shown under the bell on Today ("What's new"), whether or not push is set up.
- **Push** (`src/fcm.mjs`, `src/push.mjs`): FCM HTTP v1 from the Worker using a service-account secret
  (`FCM_SERVICE_ACCOUNT`). A cron every 30 minutes syncs users about every 3 hours within a subrequest budget and
  sends events plus due-soon reminders (about 24 h and 1 h before). Quiet hours hold and batch.
- **Settings**: Moodle alerts group (per-kind switches, quiet hours, test button), shown once Moodle is connected.
- **Not built**: a minutes-based "today's plan" digest (the Worker would need the client's plan; production's
  digest already covers manual items).
- **Unverified**: real FCM delivery and the Cloudflare cron have only run against fakes.
