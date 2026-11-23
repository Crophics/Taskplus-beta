# Agent notes — Taskplus mobile (beta)

Read this before touching anything. It's the accumulated context from the
session that built this app; a lot of it is "here's the trap that already
bit us once," not just architecture description.

## What this repo is

A ground-up mobile rebuild of [`Crophics/Taskplus`](https://github.com/Crophics/Taskplus)
(the production desktop-oriented app), built from a design handoff bundle
(originally at `~/Downloads/design_handoff_taskplus_mobile/` on the machine
that built this — `README.md` there is the full visual/interaction spec,
`DEPLOY.md` is stale, see below). This is a **separate repo on purpose**,
deployed to `beta.taskplus.cc`, so a broken beta can never take production
`taskplus.cc` down. It shares production's Firebase project (`planner-88ab8`)
for auth/sync/push — see "Firebase" below for exactly what that does and
doesn't mean.

**Merging back to production**: when this is ready, the plan (per the
original `DEPLOY.md`) was to merge this repo into `Crophics/Taskplus` —
but don't bring `wrangler.toml`'s `[[routes]]` block or any beta-specific
naming across, or production will start claiming the beta subdomain/Worker
name.

## Moodle import (Phase 1, added after the original build)

Read `docs/PLAN-moodle-import.md` for the plan and `docs/SETUP-moodle-worker.md`
for the one-time Cloudflare setup. What matters when touching code:

- **There is now a Worker.** `src/worker.mjs` (ES modules, `.mjs`) serves
  `/api/moodle/*` and passes everything else to the static assets via the
  `ASSETS` binding (`wrangler.toml`). It verifies the caller's Firebase ID token,
  exchanges Moodle credentials for a token (password never stored), keeps the
  token AES-GCM encrypted in KV, and returns mapped records. Until the
  `MOODLE_KV` binding and `TOKEN_ENC_KEY` secret exist it answers 503 and the
  rest of the site is unaffected. The `[[kv_namespaces]]` block in
  `wrangler.toml` is **commented out on purpose**: CI uses wrangler 3.x, which
  fails a deploy on a KV binding with no id.
- **Imported items are a second storage key.** `js/app.js` `loadItems()` /
  `persistItems()` split `items` between `tp-assignments` (manual, synced) and
  `tp-moodle-items` (imported; the full items stay off the cloud doc's `items`, but their Moodle details sync as `moodleItems`, below). **Never write
  `localStorage.setItem('tp-assignments', ...)` from app code directly; call
  `persistItems()`**, or imported items leak into the shared Firestore doc.
  `today-logic.js` takes a `persist` callback for the same reason. Imported items
  are identified by `item.source.type === 'moodle'`; ids are `moodle:<cmid>`.
- **`js/moodle-client.js` (`TPMoodle`)** holds the pure merge (`mergeImported`,
  tested in `test/moodle-import.test.js`) and the API wrapper. It loads right
  after `courses.js`. Moodle owns title/course/due/`source`; the user owns the
  rest.
- **Navigation is three tabs** (Today, Week, All; courses live inside All, see below). The app is built around Moodle, so
  manual add is a quiet fallback with no button of its own: a link at the bottom of All and a row in
  Settings (`[data-add-manual]`, bound in `bind-events.js`). What's new (bell, only when Moodle is
  connected) and Settings are in every main screen's header (`TPViews.headerActionsHtml` /
  `screenHeaderHtml`, context from `headerCtx()` in `app.js`). Gestures live in `js/gestures.js`
  (pure `classifySwipe`, tested): swipe between tabs, edge swipe = click the screen's own back
  button, pull down = Moodle sync. Don't add an Add button to the tab bar or a header. `TABS` in
  `app.js` still lists every screen so an old saved tab preference keeps working.
- **Tests for the Worker** (`test/moodle-worker.test.js`) use a fake Moodle
  `fetch`, a fake KV and real RSA-signed Firebase tokens; nothing touches the
  network. For changes to the wiring, the jsdom technique below still applies,
  and the Worker handler can be called directly in that script
  (`handleApi(request, env, {fetchFn})`) so the app and Worker run together.
- **Claude estimates (Phase 4).** `src/estimate.mjs` builds the prompt, sanitises the input, calls Claude
  and validates the answer; `/api/estimate` in `src/worker.mjs` adds the per-user cache and daily caps.
  The Anthropic SDK is imported lazily inside the Worker (`defaultMakeClient`) so tests and the rest of the
  Worker never need it; tests inject a fake client. CI now runs `npm ci` (the Worker bundles the SDK).
  **Never send notes, grades, account ids or credentials in a request** (`TPMoodle.modelInput` is the only
  place the payload is built; a test checks it). SDK 1.x authenticates with `Authorization: Bearer` under
  API version `2026-10-21`, which rejects `temperature`/`top_p`/`top_k`: don't add them. Claude Opus 5.5
  always thinks, so the `thinking` parameter is omitted, and forced `tool_choice` is a 400 (we use
  structured output instead). `estimate.basis` is now `'heuristic' | 'quiz-limit' | 'model' | 'user'`;
  `estimate.key` fingerprints the assignment text (`TPEstimate.inputsKey`); `item.modelTry` remembers a
  failed ask for the day; `estimate.steps` are trusted only while `steps.length === item.total`
  (`TPEstimate.stepsUsable`).
- **Gemini provider (2026-11-18).** `src/gemini.mjs` (`callGemini`) is the free alternative to Claude: plain `fetch` to
  generateContent, key in the `x-goog-api-key` header only, same prompt/schema/`validateOutput` as `estimate.mjs`.
  `pickProvider(env)` in `worker.mjs` chooses (`ESTIMATE_PROVIDER`, else Claude if `ANTHROPIC_API_KEY`, else Gemini if
  `GEMINI_API_KEY`). The request field names and the default model (`gemini-3.5-flash-lite`) come from Google's docs and
  were checked with one real key and a text and a PDF request on 2026-11-18 (it works). Tests use a fake
  `geminiFetch`. Each estimate carries `provider` ('claude' | 'gemini'; '' on estimates saved before it existed) and
  the assignment screen shows it ("Gemini estimate"). Settings wording stays provider-neutral.
- **Handouts.** `src/handouts.mjs` downloads an assignment's PDFs for Claude. This is the one place a URL from
  the browser meets the stored Moodle token, so keep it strict: same host and the site's
  `/webservice/pluginfile.php/` path only, `redirect: 'manual'`, size caps, `%PDF-` check
  (`test/handouts.test.js` covers the refusals; do not loosen it). The mapper strips any `token=` from file URLs
  (`safeFileUrl`) because records go to the browser. File addresses are sent to the Worker only when the PDF
  switch is on. Which files were read is the server's report on `estimate.files`, never the model's claim.
- **Due time (2026-11-18).** Moodle sends a due time; imports keep it as `item.dueTime` ('HH:MM', local; ''
  when none, and manual items have none). `js/due-time.js` (`TPDue`, pure, tested in `test/due-time.test.js`)
  holds the rule: due BEFORE 12:00 = the due-day morning is not usable, finish the day before (the old rule);
  due AT OR AFTER 12:00 = the due-day morning counts as half a work day (`DUE_DAY_SHARE`, a guess).
  Multi-part items split over `workDays` (e.g. 1.5 for due tomorrow after noon: 6 parts = 4 today, 2 tomorrow);
  a single-part item due tomorrow after noon is optional today (Get ahead), required tomorrow. `today-logic.js`
  and `plan-logic.js` both use it and must keep agreeing (the cross-check test covers it); without TPDue loaded
  they fall back to the old date-only behaviour, which is also what no-time items get. `dailyTarget` caches
  `dueTime`. Labels show it via `TPDue.label(item, relativeDueLabel)`; use that, not `relativeDueLabel(it.due)`.
  Overdue is time-aware too (2026-11-18): `TPDue.isOverdue(item, todayStr)` is true for a past day, or on the due day once
  `dueTime` has passed (an item with no time stays due today all day). Today's flags, All's Overdue group and row status,
  the item screen's chip, `canIgnore` and `applyIgnored` use it; Week and the planner still treat due-today work as today's.
- **Your own estimates sync (2026-11-18).** Imported items are device-only, so an estimate you set yourself did not
  follow you. `tp-imported-estimates` = `{itemId: {m: minutes | null, at}}` (null = you reset to automatic), synced in the
  Firestore doc as `estimates` and merged newest-wins (`TPMoodle.mergeEstimateMap`). Entries are written ONLY by
  `adjustEstimate`/`resetEstimate` in `app.js` (never derived from the items: a device that has not received the map yet
  must not overwrite it), and applied by `TPMoodle.applyEstimates` after cloud data arrives and after each Moodle import.
  AI estimates are not synced; each device asks and the Worker's per-account cache answers the repeat ask.
- **How long it really took (2026-11-18).** Finishing an item with an estimate opens a quick sheet (`timeFor` in `app.js`,
  `js/views/time-sheet-html.js`); a chip or custom minutes saves `item.actual = {minutes, est, at}` (est = the ORIGINAL
  estimate, `TPLearn.rawEstimate`, so ratios never compound). Imported actuals sync as `tp-imported-actuals` -> `actuals`
  (`TPMoodle.setActualEntry/mergeActualMap/applyActuals`, newest wins). `js/learning.js` (`TPLearn`, pure, tested) scales
  an open imported item's heuristic/model estimate by the median actual/estimate of >= 2 finished SIMILAR items (same
  course + kind + title with numbers removed: "Journal #1..#4" yes, an essay no). The original is kept in `estimate.raw`,
  the reason in `estimate.learned`; it is undone when the data goes away. User estimates and quiz limits are never scaled.
  `applyLearning(items)` is idempotent and runs on load, after Moodle import/AI results and after cloud data.
- **The AI is shown your finished work (2026-11-18, your request).** `modelInput(..., past)` adds `past` = up to 12
  `{title, minutes, sameCourse}` from `TPLearn.pastWork` (items with an `actual`; same course first, then newest) and
  nothing else about them (no descriptions, notes, dates). `src/estimate.mjs` `sanitizePast` re-cleans it, `buildUserContent`
  adds a fenced `<past_work>` block, the system prompt tells the model to judge similarity itself and say so in the
  rationale, and `past` is part of `cacheMaterial` (`PROMPT_VERSION` v3). The Worker stamps `pastCount`; `fromModel` stores
  `estimate.usedHistory`, and `applyLearning` then skips that estimate (no double scaling). The title-match scaling stays as the
  fallback for heuristic estimates and AI estimates made before any history. Settings wording discloses this. Not verified
  against a real model (no key on the dev machine at the time): ask one real estimate and read the rationale.
- **You can edit the plan (2026-11-18).** Assignment screen -> Plan -> Edit (or "Split into parts" on a one-part item): rename
  parts, set each part's minutes, add (max `MAX_PARTS` = 8) or remove parts; total <= 10 h. Only for dated, unfinished, non-quiz
  imported items. Finished parts are locked; at least one editable part must remain. `planDraft` in `app.js` (typing patches only
  the total line, never renders; add/remove/save render), pure logic `TPEstimate.planRows/checkPlan/withPlan`. Saving makes a
  `basis: 'user'` estimate whose `steps` are the parts (`total = steps.length`), and the synced estimate entry carries them
  (`{m, at, s: [{name, minutes}]}`, `cleanPlan` in `moodle-client.js`) so other devices get the same plan.
- **Moodle's own details sync too (2026-11-23, your request).** The cloud doc field `moodleItems` = `{itemId: {b: {title, course, due, dueTime, createdAt, source}, at}}`
  (`TPMoodle.cloudBaseOf/setCloudEntries/mergeCloudMap/applyCloudItems`, local copy `tp-moodle-cloud`). It lives in its OWN field, never in `items`,
  so production Taskplus never shows Moodle items. It only FILLS GAPS: on `tp-remote-data` an id this device does not have (and that is not in
  `deletedLog`) becomes an imported item (same builder as a real import, `buildImportedItem`, no alert events); an item the device already
  has is left alone, and Moodle's own import still overwrites title/course/due/source. Entries are rewritten only when the details change,
  carry no notes/estimates (their own maps do that), no file download addresses/tokens, a description capped at 4000 chars, at most 6 files;
  they age out 45 days after the due date, are dropped when the item is deleted, and the map is capped at 150 entries. `syncPush` refreshes it.
  Privacy page updated. A device that never imports (not connected) still gets items; its next sign-in to Moodle then takes over.
- **The account's data comes before Moodle (2026-11-23).** `firebase-sync.js` keeps `initialSyncDone` (false from sign-in until the first getDoc + merge +
  push has finished or failed) and dispatches `tp-cloud-ready`; `push()` does nothing before that (a device pushing its still-empty maps first would
  overwrite the account's progress/estimates/notes), and `app.js` `moodleMaybeAutoSync` waits for it (`cloudPending`, set on `tp-auth-changed`).
  Manual "Sync now" is never held back. Jsdom-checked (sign in -> nothing; cloud ready -> the Moodle sync runs).
- **What syncs (audit 2026-11-18).** The cloud doc (`users/<uid>/taskplus/data`, written with `setDoc(..., {merge:true})` so an
  older cached version of the app can never wipe fields it does not know) holds: manual `items` (everything on them),
  `courses`/`courseColors`/`deletedCourses`, `prefs` (minus theme and tab), `dayCompleteLog`, `deletedLog`, and, for IMPORTED
  items (which stay off the cloud), these side maps, each `{itemId: {..., at}}` merged newest-wins in `firebase-sync.js`:
  `ignored`, `progress` (done/completed/completedAt plus `td`/`tdd` = parts finished today and the day, so "left today" agrees),
  `estimates` (your own number/plan), `aiEstimates` (the AI's answer: `TPMoodle.aiRecordOf/setAiEntry/mergeAiMap`; applies only
  while the assignment text key `k` matches; vs `estimates` the newer `at` wins; answers made before entries existed are seeded
  from `item.updatedAt` and never over your own estimate), `actuals` (time taken), `notes` (`item.notesAt` is the local time;
  typing pushes 1.5 s after it pauses). `applySyncedMaps()` in `app.js` applies all of them (load, cloud data, after a Moodle
  import, after an AI answer). **Rule for any new per-item field on an imported item: add a map, merge, apply, and the three
  spots in `firebase-sync.js` (`readLocalPayload`, `writeLocalPayload`, `applyRemoteMerge`).** Deliberately per device: theme,
  open tab, the AI and handout switches (`tp-llm-on`, `tp-llm-files`; privacy choices), the What's-new feed, Moodle connection
  cache, `modelTry`, push tokens (server side), dev-mode keys. Moodle itself provides title/course/due/description on each device.
- **Parts are days, so never more parts than usable days (2026-11-18).** `TPEstimate.maxParts(item)` = ceil of
  `TPDue.workDays` (due tomorrow before noon = 1; due tomorrow after noon = 2). `withEstimate` caps `total` to it and folds extra
  steps into the last one (`capSteps`); `TPLearn.refitParts` re-applies this to untouched, not-your-own plans on load/sync.
  `modelInput` sends `workDays` and the prompt says `days_available_to_work`: NEVER more steps than that (`due_in_days` alone
  overstates it for a morning deadline). A plan you edited yourself is never capped. Prompt v6.
- **Part size without the AI (2026-11-18).** `PART_MIN` = 90: work up to about 90 minutes is ONE part (one sitting), longer work gets
  `round(minutes / 90)` parts (max 8), always capped by the usable days (`maxParts`). Parts are separate days. A finished
  assignment's screen has a "Time taken" row (Add/Change) that opens the same time sheet, so past work can be given a time.
- **Push alerts are live (2026-11-18).** `FCM_SERVICE_ACCOUNT` is a key for a dedicated service account in project
  `planner-88ab8` (role Firebase Cloud Messaging API Admin; the key file's name starts with the project id, so a `gen-lang-client-...`
  key is from the wrong project and gives a 403). Traps found on the way: (1) `sw.js` has its OWN first-registered `push` listener
  that always shows data-only alerts, because Firebase's SDK hands a message to an open page when it thinks a window is visible,
  and on iPhone a suspended Home Screen app counts, so the alert vanished (`test/sw-push.test.js`); (2) the page-side foreground
  handler must use `registration.showNotification`, never `new Notification()` (throws on iPhone); (3) the test route reports
  Google's reason and the devices it went to (`deviceLabel`), and a 400 only forgets a device when Google says the token is
  invalid; (4) every permission toggle or reinstall adds a registration (max 5), stale ones stay until Google reports them dead.
  Verified on a real iPhone: the test alert. Not yet seen live: new-assignment, moved-date and due-soon alerts from the cron.
- **Free-plan budget for the background sync (2026-11-18).** `src/push.mjs`: the cron (every 30 min) syncs a user at most every
  `CRON_SYNC_EVERY_MS` (175 min, slack for an early tick) and only while `inSyncWindow` (06:00 to 21:00 in the user's stored time
  zone). Due-soon reminders still run on every tick. To stay under KV's 1,000 writes/day an idle check writes nothing
  (`notifyUser` saves push state only if it changed), `processSync` saves the snapshot only if its items changed (its own `at`
  does not count), and the only per-sync writes are the last-sync time and the `lastCron` stamp (`touch`). Tests: `test/push.test.js`.
- **Delete my data (2026-11-18).** Settings -> "Delete my data" (`deleteMyData` in `app.js`): `POST /api/account/delete` (repeated
  while `more`, 30 cached AI answers per call because of the free plan's per-request storage-call cap) removes `moodle:`, `snap:`,
  `evt:`, `push:` and `est:<uid>:*`; then `tpSync.deleteCloudData()` deletes the Firestore document, signs out, clears every `tp-*`
  localStorage key and reloads. The daily counters (`estn:`/`estf:`) are kept on purpose (no content, 2-day expiry, and deleting
  must not reset the AI limits). Other devices keep their local copy. **If you add a new server-side key for a user, delete it here too.**
- **Background failures are visible (2026-11-18).** `runCron` no longer swallows a user's failed sync silently: `noteCronError` logs one
  line (`cron: a user sync failed (<code>)`, never ids, tokens or messages, so it is safe in Cloudflare's logs) and stores
  `lastError: {code, at}` on that user's `push:` record, written only when the code changes and cleared by the next good sync.
  `/api/push/status` returns it and Settings -> Moodle alerts shows a warning line. Look at the Worker's logs in the Cloudflare dashboard.
- **Who can connect, and what address it may reach (2026-11-18).** Invite codes live in KV as entries `code:<code>` (value = a note; managed in the dashboard, no deploy) and/or the optional `INVITE_CODES` secret; the gate is on while either has a code, off when neither does (`inviteState` in `worker.mjs`; codes must match `/^[\w.-]{4,100}$/` before KV is touched; a used code's entry gets ` [used <date>]` appended). When on,
  `/api/moodle/connect` answers 403 `invite_required`/`invite_invalid` before looking at the password or contacting Moodle; the connect
  sheet then shows an "Invite code" field (remembered in `tp-invite`). Each code is ONE-TIME: after a successful connect `invite:<sha256(code)>` stores `sha256('uid:'+uid)`; another account gets 403 `invite_used`, the same account can reconnect, a failed login does not burn it (only hashes are stored; two truly simultaneous redemptions could both pass, KV is eventually consistent). Already-connected users are unaffected. `normalizeSite` rejects
  trailing-dot hosts, more internal suffixes, numeric TLDs and IP spellings; `postForm` uses `redirect: 'manual'` and refuses any 3xx
  (hinting the real host), so a redirect can never receive the password or token or point the Worker elsewhere. Tests: `test/moodle-worker.test.js`.
- **The intro tour shows the real app (2026-11-18).** `js/tour.js` (`TPTour`) puts a layer outside `#tp-app` with an iframe of this same app
  opened as `index.html?demo=1`, a spotlight over a real element, and one card at a time (10 steps; skip always available). `js/demo-data.js`
  runs first in `<head>` and, only for `?demo=1`, replaces `localStorage` with an in-memory copy seeded with four sample imported assignments
  (so nothing tapped in the preview can touch real data); if the browser refuses the swap it sets `TP_DEMO_BROKEN` and `app.js` refuses to start.
  `TP_DEMO` also stops the preview from loading `firebase-sync.js` (index.html writes that tag with `document.write` to keep normal timing),
  registering/resetting the service worker (`boot.js`), replaying the intro or starting a nested tour. The tour drives the preview by clicking its
  own buttons and finds highlights by selector (`.tp-t-row`, `.tp-log`, `.tp-i-parts`, `.tp-w-chart-block`, `.tp-a-controls`, the Notifications
  group): **if you rename those, update `STEPS` in `tour.js`**. If the preview does not load in 9 s the same steps show as plain cards. The sample
  due dates are relative to today so Today always has a target, a + button and a Get ahead item (Problem set 5 is due in 2 days on purpose).
  Tested: `test/tour.test.js` and jsdom runs of every step's enter/target; never seen in a real browser.
- **AI is opt-in (2026-11-19).** `tp-llm-on` and `tp-llm-files` are OFF unless the stored value is exactly `'1'` (`app.js`; Settings shows the
  switches off, the privacy page says so). With it off nothing about an assignment is sent anywhere: estimates come from the rule of thumb, "Ask
  again" is unavailable, and `requestModelEstimates` returns before any request. Devices that never touched the switch changed from on to off
  when this shipped. The setting is per device (not synced) on purpose: it is a privacy choice. Anything new that sends data to a third party must
  sit behind an opt-in switch like these.
- **Add to Home Screen (2026-11-18).** `TP.needsHomeScreen()` (iPhone/iPad, not standalone) puts an `install` step FIRST in onboarding
  (the Home Screen app has its own storage, so installing after signing in would lose the progress; "I will do it later" sets
  `tp-install-skip`) and a warning line at the top of Settings -> Notifications. Push does not work from a Safari tab on iPhone.
  Privacy page and the AI setting now say plainly that the free Gemini tier lets Google use what is sent to improve its products
  (it is the unpaid tier's terms; paid tier is treated differently, and linking a billing account makes all use "paid").
- **Onboarding and Settings layout (2026-11-18).** `js/views/onboarding-html.js` + the `ob*` functions in `app.js` (state `onboard`, `null` = off):
  a welcome screen when the server requires codes ("I have an invite code" -> code step -> sign-in, or "Sign in to my account" for someone already
  activated, e.g. on a new device: after sign-in `moodleBoot` finishes onboarding straight away, no tour, if the account is connected, else goes to the
  Moodle step, whose connect sheet asks for a code if the server wants one; `onboard.returning`; `POST /api/invite/check` is public, answers
  required/valid/invalid/used and consumes nothing) -> Google sign-in -> connect Moodle (reuses the connect sheet) -> a 6-page tour. It starts only on a device with no items, no connection and no
  sign-in and no `tp-onboarded` flag; anyone with data is marked onboarded silently. Progress is kept in `tp-ob-step` (a reload resumes), the
  tab bar and gestures are off while it shows, signing in or an already-connected account skips ahead (`tp-auth-changed`, `moodleBoot`). Sign-in
  and Moodle can be skipped; the code cannot. Settings -> About -> "Show again" replays only the tour (`replayIntro`). Settings now reads Account,
  Moodle, Notifications (permission + alert rows + daily digest), Time estimates, Appearance, Your data, About, Danger zone; every control keeps
  its element id (`bind-events.js` finds them by id). The tour text describes real behavior (Targets/Get ahead, parts are days, swipe tabs,
  pull to sync, edge-swipe back): update it when those change. Verified only with jsdom; no real browser.
- **Get-ahead work is not planned on today (2026-11-18).** `plan-logic.js` `allocateItem` puts only REQUIRED work on
  today (a multi-part item with units left >= work days, the same `noSlack` test as `today-logic.js`). An item with
  slack has nothing to do today (Today lists it under Get ahead, optional); its units go on the LAST days they can
  wait, one per day, so Week's bar for today equals Today's "left today" exactly and doing work early just means less
  later. A side effect: work due beyond the 7-day window does not appear in the chart until it has to be done.
  `todaySummary.aheadMin` still exists but is no longer shown. Tests: `test/plan-logic.test.js`, `test/due-time.test.js`.
- **Manual items are estimable too (2026-11-19).** The Add sheet (title, course, due date + optional time, description, optional minutes,
  notes; no subtasks, amount/unit/repeat/dependency) creates `total: 1`, `source: {type: 'manual', kind: 'assign', description}` and an
  estimate (`TPEstimate.isEstimable(it)` = source.type moodle OR manual; use it, not `isImported`, for anything about estimates, parts,
  learning, the AI and the item screen). They are NOT imported (`TPMoodle.isImported` is false): they still sync as whole items through
  `items`, so no side maps are needed. Editing description/title re-estimates (your own minutes win; a blank field goes back to
  automatic); the AI is asked after save when the opt-in switch is on. Older items without `source` are CONVERTED on load and after cloud data (2026-11-23, `TPEstimate.convertLegacy`, idempotent; production Taskplus keeps
  making items like that, so they keep arriving): `source.type 'manual'`, your own minutes if set else a rule-of-thumb estimate from the title, and parts
  when there is no progress yet (the amount/unit are replaced); with progress the amount stays so logged units keep their meaning. Finished, archived and undated
  items are left alone; notes, subtasks, repeat and dependency stay on the item. Dev mode trigger = title "dev mode" + a 101-minute estimate. Verified with jsdom (add, edit, detail).
- **Estimates and minutes planning (Phase 3).** `js/estimate-logic.js`
  (`TPEstimate`, a rule-of-thumb estimator; its constants are guesses, see the
  header) and `js/plan-logic.js` (`TPPlan`, minutes per day, heavy day) are pure
  and tested. `item.estimate = {minutes, low, high, basis: 'heuristic' |
  'quiz-limit' | 'user', confidence, factors}`. Imported unfinished work is split
  into ~50-minute parts by setting `total` (and `unit: 'part'`); never re-split an
  item that has progress (`TPEstimate.withEstimate` enforces this). A `user` basis
  estimate must never be overwritten by a sync. **Trap:** `TPPlan.computeDays`
  takes `today` as a date STRING, whereas `TPWeekLogic` and `TPTodayLogic` take a
  function; passing the function gives `NaN` days. `test/plan-logic.test.js`
  cross-checks the planner against `today-logic.js`; keep that test passing if
  either pacing rule changes. Assignment detail is `tab === 'item'` (never saved
  as the tab preference); it opens only for imported items that have an estimate.
- **There are no grades in the app (decided 2026-11-17).** Phase 2 (grades, weights, GPA) was built and then
  removed: this school's Moodle omits `grademax` and reports weights renormalised over the items graded so far, so
  its numbers cannot match the syllabus, and the goal is organising work, not replacing Moodle. The Worker never
  calls `gradereport_user_get_grade_items`; don't add it back, and don't bring back the `tp-moodle-grades` /
  `tp-grade-settings` keys (the app deletes them on load). Tabs: there is no Courses tab or course detail screen any more (merged into All, 2026-11-18): All's **Course** sort
  (`TPAllLogic.buildGroups`, given `courses`) shows a section per course, including courses with no
  assignments yet; the course dropdown filters to one course; `manage` = the course manager (Settings). A saved
  `courses`/`course` tab preference opens All.
- **Undated work and Ignore (2026-11-17).** An assignment or quiz with no due date is imported with `dueTs: null`
  and `item.due === ''` (the Worker no longer drops it, and there is no `skipped_no_due_date` warning). **`due`
  can be empty: never call `daysBetween`/`localeCompare` on it without checking.** `TPItemLogic.isPlanned(it)`
  (has a due date and not `ignored`) is the rule; Today, Week and the minutes plan skip unplanned items, and
  `today-logic`, `week-logic` and `plan-logic` carry a one-line copy of it because they load without
  `item-logic.js` (keep the copies in sync). Undated items are never split into parts (`withEstimate`) and are
  listed under "No due date" on All and in Course detail only. **Ignore** (`item.ignored = true`, `app.js`
  `setIgnored`) is offered only for overdue, unfinished work (quick menu and item detail); ignored items leave
  the overdue counts, Today, Week, Courses' open count and Claude asks, and sit in All's "Ignored" group. It is
  user-owned (a sync keeps it) but ends if Moodle gives the item a due date that is not in the past.
- **Moodle `accessexception` is not an auth failure** (`src/moodle-client.mjs`):
  it means the school has not enabled a function for the mobile service. Only
  `invalidtoken` disconnects a user.
- **Alerts (Phase 5).** `src/events.mjs` (pure: snapshot, diff, wording, due-soon, quiet hours), `src/fcm.mjs`
  (service-account JWT, data-only FCM v1 send, the shape `sw.js` displays), `src/push.mjs` (KV: `push:<uid>`,
  `snap:<uid>`, `evt:<uid>`, all sealed; `processSync`, `notifyUser`, `runCron`). `/api/push/*` routes live in
  `worker.mjs`; the default export has a `scheduled` handler (`*/30 * * * *`). The first snapshot is a baseline
  (no events); a user's own in-app sync records events to the feed but never pushes (`notify:false`). Reminder
  keys include the due timestamp so a moved date reminds again. Client: `tp-push-token` (dispatched by
  `firebase-sync.js`) registers the FCM token with the Worker; `tp-feed` is the device-local feed; tab `changes`
  (bell on Today) is never persisted. Disconnect deletes `snap:`/`evt:`. Tests use fake KV/FCM; real FCM and cron
  are only verifiable on a deployed Worker with a real device. Production's `functions/` digest stays separate.
- **No class times (removed 2026-11-18).** The per-course class schedule (`js/schedule-logic.js`, `tp-schedule`, Today's "Classes today", Week's day card) was manual, device-local and fed nothing, so it was deleted; the app clears a leftover `tp-schedule` key on load. Don't bring it back without asking.
- **Cutover (Phase 7).** `docs/CUTOVER.md` is the checklist; `tools/compare-vault.mjs` compares the vault's
  Coursework notes (`link: ...id=<cmid>`, `due`, `status`) with a Backup export, matching on cmid. Read-only.
  It reads notes with `tools/vault-frontmatter.mjs`.
- **`.assetsignore` already hid repo internals** (`*.md`, `test/`, etc.); `src/`
  was added to it. Don't rewrite that file wholesale.

## Orientation

Buildless, no bundler, no framework. Every `js/*.js` and `js/views/*.js`
file is a plain `<script>` tag loaded in a specific order from `index.html`
— **order matters** (later files assume earlier ones already ran and
attached their global). Every module attaches itself to `window` under a
`TPXxx` namespace (`TPCourses`, `TPTodayLogic`, `TPAllLogic`, `TPWeekLogic`,
`TPIcons`, `TPViews`, `TPBind`, `TP` for generic utils, etc.) via the
`(function(global){ ...; global.TPXxx = {...}; })(typeof window !== 'undefined' ? window : globalThis)`
IIFE pattern — this dual-environment pattern is *why* the modules work
unmodified in both the browser and Node's test runner (`node --test` loads
them with `global.window = global` at the top of each test file).

Load order in `index.html`, roughly: `utils.js` (TP) → `item-logic.js` →
`icons.js` (TPIcons) → `courses.js` → `all-logic.js` → `week-logic.js` →
`html.js` (escapeHtml) → `toast.js` → `theme.js` → `notify.js` → `io.js` →
`views/*.js` (in a specific order too, see the file) → `today-logic.js` →
`bind-events.js` → `boot.js` → `app.js` (last — it calls `render()` at its
own bottom, kicking off the whole app). If you add a new module, insert its
`<script>` tag in the right spot, not just at the end.

## The render loop — read this before touching bind-events.js

`js/app.js`'s `render()` rebuilds the *entire* `#tp-app` subtree
(`root.innerHTML = html`) based on current state (`tab`, `draft`, `menuFor`,
etc.), then calls `window.TPBind.bindEvents(root, buildApi())` to re-wire
every handler from scratch (rebinding is cheap; DOM rebuild is what's
expensive and bug-producing). `buildApi()` constructs the `api` object
handed to `bindEvents` fresh every time — getters/setters closing over
app.js's own local variables. **If you add new state, add it in three
places**: the `let` declaration, the `buildApi()` getter/setter, and
wherever the view's ctx object is built in `render()`.

**Never let a full render happen while the user is typing into a focused
input** — the input gets destroyed and recreated, killing focus and the
caret position mid-keystroke. This was the entire subject of an earlier
fix pass (`FIX-render-loop.md`, if it's still around). The pattern that
resulted:
- Fields with **nothing else on screen depending on them** (title, notes):
  update the model only, no render, no patch.
- Fields that drive **one other piece of UI** (amount/unit/due → the pacing
  hint; subtasks → the subtask-count sublabel; new-course-name → the Add
  button's `disabled`): patch just that one node directly via
  `document.getElementById(...).innerHTML = ...` (or the specific property),
  no render.
- Fields that drive a **whole list** (All-tab search): use `api.patch(id,
  html)` — replaces one container's innerHTML and re-runs `bindEvents`
  globally, but doesn't touch the rest of the page (so the search input
  itself is never destroyed). `api.allCtx()` builds the exact ctx
  `allScreenHtml`/`allResultsHtml` need, factored out so both a full render
  and a patch can call it identically.
- Anything that **changes structure** (opening the course picker, toggling
  the disclosure, submitting, canceling) still calls `api.render()` — that's
  fine, those aren't per-keystroke.

**Closing an overlay must not wait on an unrelated animation.** The
quick-action menu's Delete used to stay open until the deleted card's
slide-out animation finished (300ms), because nothing called `render()`
until `deleteItemAt`'s `finish()` did. Fix was: `api.menuFor = null;
api.render();` (closes the menu immediately) *then* `api.deleteItemAt(idx)`
(grabs the now-freshly-rendered card and animates *that* one, independently).
If you add a new destructive action from the quick menu, follow that order.

**Avoid double-renders.** `logOne`/`toggleComplete` (in `bind-events.js`)
already end in `api.save()`, which renders. Don't *also* call
`api.render()` right after — set `api.menuFor = null` *before* calling
them instead, so their own save-triggered render already reflects the
closed menu.

## The pacing model

`js/today-logic.js` is the one place with real product logic, not just
templating. Each item carries a `today` counter (units logged *today*,
reset by `resetTodayCounters()` — called once at load in `app.js`, compares
a stored `tp-last-active-date` against `TP.today()` and zeroes every
item's `.today` on a new day). `dayTarget(it)`/`met(it)` implement the
design's pacing formula. Separately, `computeTodayPanel()` buckets items
into `requiredTight` / `requiredPace` / `optionalBuckets` / `pickBuckets` —
this bucketing logic is **more sophisticated than the original design
doc's pseudocode** (handles N-of-M "pick" buckets, due-tomorrow catches,
no-slack pacing) and was deliberately kept as-is rather than simplified to
match the doc. `computeTodayScreen(panel)` re-buckets that output into the
mobile UI's two sections (Targets = unmet required; Get-ahead = met
required + everything optional) — see its comment for exactly why a met
item needs `dailyTarget.amt` (cached, stable all day) rather than live
`noSlack` to detect the transition correctly.

Logging a unit increments `done` and `today` together (see `logOne` in
`bind-events.js`) — `today` is *not* derived from `done`, it's its own
counter, specifically so the day-rollover reset can zero it independently.

## Courses — a collection, not a foreign key

`courses.js` manages `{id, name, color}` entries in a `courses` array
(`localStorage['tp-courses']`), but **items still store `course` as a
plain string**, not a course id. This was a deliberate choice:
`firebase-sync.js`'s merge/dedup logic (`itemKey`/`contentKey`) keys on
that string, and switching to an id would have meant rewriting sync merge
logic on top of everything else. Renaming a course rewrites every
matching item's `.course` string (`TPCourses.renameCourse`); deleting one
only removes the courses-list entry — items keep their string and fall
back to a grey swatch (`TPCourses.FALLBACK_COLOR`) via `colorFor()`.

`dependsOn` (task dependencies) matches **by title string**, not id, per
`js/item-logic.js` (this predates the mobile rebuild). Renaming an item
has to cascade to anything that depended on the old title — see the
`oldTitle !== title` check in the add-sheet submit handler in
`bind-events.js`. If you ever add course-rename-triggered dependsOn
rewrites, note courses and dependsOn use *two different* string-matching
mechanisms; don't conflate them.

The legacy `tp-course-colors` field (a plain `{normalizedName: hex}` map,
predates the `courses` collection) is still read and round-tripped through
`syncPush()`/Firestore even though nothing in this app writes to it
anymore — purely so a push from here doesn't blank the field out for the
production desktop app if the same account is signed into both. Don't
remove that plumbing without checking production still needs it.

## Icons

`js/icons.js` exports `TPIcons.svg(name, {className, title})`, embedding
inline `<svg>` markup with hand-extracted path data (18 icons, ~4KB total).
**This replaced a self-hosted Nerd Fonts subset, which replaced a remote
CDN link** — both earlier approaches broke in ways worth knowing about:

1. The remote `nerdfonts.com` CDN link (design doc's original suggestion)
   is a marketing site, not a real CDN — slow/blocked loads blanked every
   icon in the app.
2. Self-hosting a `pyftsubset`-extracted `.woff2` fixed that, but a static
   grep for icon usage missed the tab bar's *dynamically* built class name
   (`` `nf-md-${icon}` ``) — so 4 glyphs (calendar_today, format_list_bulleted,
   chart_bar, cog_outline) never made it into the subset, and the entire
   tab bar rendered blank. Font subsetting is fragile to exactly this kind
   of dynamic-class-name blind spot.
3. Inline SVG (current) sidesteps both failure modes entirely — no
   separate file, no `@font-face` load race, no subsetting step to get
   wrong. **If you need a new icon**: extract it from the original Nerd
   Fonts "Symbols-2048-em" font with `fontTools` (`SVGPathPen` +
   `TransformPen` with matrix `(1,0,0,-1,0,2048)` to flip Y into SVG
   coordinates), then **check the actual glyph bounding box against the
   font's `hhea` ascent/descent** before picking a `viewBox` — this font's
   baseline isn't centered in its em square (ascent 1638 / descent -410),
   so a naive `viewBox="0 0 2048 2048"` clips the bottom and leaves dead
   space at the top. The correct `viewBox` is `"0 410 2048 2048"` (already
   used for all 18 current icons — reuse it, don't rederive per-icon
   unless a new glyph's bbox actually falls outside `[410, 2458]`).

## CSS — the specificity trap that bit us twice

`css/mobile.css` has page-shell reset rules:
```css
#tp-app button{margin:0; ...}
#tp-app input,#tp-app select,#tp-app textarea{margin:0; ...}
```
These are **ID + element** selectors (specificity `(1,0,1)`). A plain
class selector like `.tp-add-submit{margin-top:24px}` is `(0,1,0)` —
**it loses**, silently, regardless of source order. Two separate spacing
fixes landed correctly in the CSS but did nothing visually until this was
found and every affected button/input class got prefixed with `#tp-app`
to win the specificity fight (`#tp-app .tp-add-submit{...}`, etc.).
**If you add a margin to any button or input-family class and it doesn't
seem to apply, this is almost certainly why** — prefix the selector with
`#tp-app`.

Three CSS files, by design:
- `css/tokens.css` — theme tokens only (`--bg`, `--surface`, `--accent`,
  etc.), one `:root[data-theme="..."]` block per theme (`dark` /
  `Nocturne`, from the design spec, exact values; `light` and `blue` are
  hand-derived, *not* in the source design, kept only so the theme
  switcher doesn't break).
- `css/mobile.css` — everything else: page shell/reset, every component.
- `css/animations.css` — `@keyframes` and the `prefers-reduced-motion`
  media query only.

**Deleting a CSS file is not safe just because grep shows the class name
elsewhere as "legacy."** `css/components.css` was deleted as dead weight
in an early pass; it turned out to hold the *only* rule that ever applied
the `.tp-removing` slide-out animation. `deleteItemAt()` in `app.js` waits
on that animation's `animationend` event before actually splicing the item
out — with the rule gone, that event never fired, and Delete silently hung
forever whenever the target card was still in the DOM. Found by
**systematically diffing every class/id string referenced in `js/**/*.js`
against what's actually defined across `css/*.css`** — that technique
(basically: `grep` every `class="..."`/`getElementById`/`classList.add`
target out of the JS, then check each one has a matching CSS rule) is
worth re-running any time a CSS file gets deleted or heavily edited; it's
what also caught the toast (`#tp-toast`, appended straight to `<body>` by
`js/toast.js`, had zero CSS at all) and the drag-reorder feedback
(`.tp-dragging`/`.tp-drop-target`, also zero CSS) — both regressions from
the same components.css deletion, just less immediately obvious than
delete hanging.

`deleteItemAt` now also has a `setTimeout(finish, 400)` safety net
alongside the `animationend` listener, guarded so whichever fires first
wins and the other is a no-op — so a *future* CSS/animation mismatch can't
fully hang deletion again, just skip the slide-out visual.

## Deploy

**GitHub Actions auto-deploys on every push to `main`** (`.github/workflows/deploy.yml`:
runs `npm test`, then `wrangler deploy` to Cloudflare on success). The
Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are
already configured on this repo — **there is no "commit now, deploy
later" step; every push to main that passes tests goes live within
about a minute.** Check `gh run list --repo Crophics/Taskplus-beta` if
you need to confirm a deploy went out.

`wrangler.toml` declares `beta.taskplus.cc` as a custom domain route —
Cloudflare auto-provisions the DNS + SSL cert for this since `taskplus.cc`'s
zone is already on the same Cloudflare account. If a fresh clone/fork ever
needs to redeploy from scratch, `npx wrangler deploy` (with the same
account authenticated) recreates the Worker and route.

The workflow has `paths-ignore: '**/*.md'` — a commit that only touches
`.md` files (like this one) does **not** trigger a deploy. That's correct
behavior, not a bug, if you're wondering why a doc-only push shows no
Actions run.

**"Reaching Cloudflare" is not the same as "reaching the user's browser."**
`sw.js` is a cache-first service worker: `CACHE_NAME` is the only thing
that makes it fetch fresh copies of the precached files (`urlsToCache`) —
bumping it is what evicts the old cache in the `activate` handler.
**Every commit that changes a precached file needs to bump `CACHE_NAME`
again, not just the first time that file was touched.** This actually
happened: `js/icons.js` got the viewBox fix in the same commit that bumped
`CACHE_NAME` to `v21`, then three more commits fixed the icon further
(replaced its shape, fixed its size, fixed a rendering bug) *without*
bumping `CACHE_NAME` again — so returning visitors kept getting served the
`v21`-cached `icons.js` through all three follow-up fixes, and no amount
of manually reloading the page fixed it (a plain reload asks the service
worker first, which returns its cache before ever touching the network).
`curl`ing the live URL to verify a fix is real, but it proves nothing
about what a *cached* visitor's browser is actually running — check
`CACHE_NAME` got bumped in the same commit as the fix, every time.
`js/boot.js`'s `SW_RESET_FLAG` is the nuclear option (unregisters and
re-registers unconditionally, once per flag value) for when a normal
`CACHE_NAME` bump isn't cutting it fast enough — bump *that* string too if
several `CACHE_NAME` bumps in a row haven't visibly reached a specific
device, since iOS Safari's own service-worker update check is documented
to be slow/unreliable on top of this.

## Firebase — what's actually shared with production

This app's `firebaseConfig` (in `firebase-sync.js`) and VAPID key (in
`js/fcm-config.js`) are **copied verbatim from production** and point at
the same project (`planner-88ab8`) — deliberate, so signing in here syncs
the same data and push notifications work identically. Consequences:
- `beta.taskplus.cc` had to be added to Firebase Auth's authorized domains
  (Console → Authentication → Settings → Authorized domains) — already
  done; if this ever moves to a new domain, that step has to repeat.
- Cloud Functions (the scheduled digest, `functions/index.js`) are **not**
  deployed from this repo's CI on purpose — the functions/ directory here
  is present but inert; production owns that deployment so the same
  scheduled function doesn't get double-deployed from two repos.
- `courseColors` (legacy) and `courses` (current) both round-trip through
  the shared Firestore doc — see "Courses" above for why `courseColors`
  is still touched at all.

## Testing

`npm test` runs `node --test` over `test/*.test.js` — pure-function unit
tests for `today-logic.js`, `all-logic.js`, `week-logic.js`, `courses.js`,
`item-logic.js`, `html.js`, plus streak/day-complete logic. These load the
real `js/*.js` files directly (`global.window = global; require('../js/x.js')`)
so they exercise actual production code, not reimplementations. (`test/streak-notice.test.js`, which only tested a phantom copy
of removed streak-banner logic, was deleted 2026-11-18.)

`npm run lint` runs `eslint js/`.

**There is no automated UI/e2e test.** The technique used throughout this
build for verifying actual interaction behavior (render-loop correctness,
click handlers, DOM state after a sequence of actions) was a disposable
Node script using `jsdom`: construct a `JSDOM` with `runScripts:
'outside-only'`, `window.eval()` every `js/*.js` file in the real
`index.html` load order, seed `localStorage['tp-assignments']`, then drive
it with `dispatchEvent(new window.MouseEvent('click', {bubbles:true}))` /
`PointerEvent` / `Event('input', ...)` and assert on the resulting DOM or
`localStorage`. `jsdom` doesn't run real CSS (no layout, no animations, no
`animationend`) — that's *why* the delete-hang bug needed a
`setTimeout` fallback found by manual code reading, not by a jsdom test;
jsdom can prove the JS wiring is correct but can't catch a CSS rule that
never fires an animation, or purely visual issues (z-index, overlap,
scrollbar `[hidden]` behavior). Write these as one-off scripts in a scratch
location, run with plain `node scriptname.js`, delete when done — don't
commit them.

## Known low-priority gaps (not fixed, on purpose, low stakes)

- The dev toolbar (`#tp-dev-toolbar-btn` etc., only visible via the secret
  "Dev Mode" / 101 title+total trigger) has zero CSS — same
  components.css-deletion pattern as the toast/drag bugs, but it's a
  hidden developer-only panel so no user ever sees it broken.
- `burstConfetti` (in `js/utils.js`) still uses the old desktop palette
  hex codes for confetti particles, not the Nocturne `--accent`/`--ok`/
  `--warn`/`--danger` tokens the design spec lists for confetti
  specifically.
- The mobile Add sheet only exposes title/course/due/amount+unit by
  default; notes/subtasks/repeat/dependency live behind a "Notes,
  subtasks, repeat, dependency" disclosure (auto-expanded when editing an
  item that already has any of the four set). This is intentional (the
  design's stated rationale: 9 fields always visible makes the common
  case slow one-handed), not a bug.
- No self-hosting for the Inter font (still Google Fonts CDN) — lower risk
  than the Nerd Fonts situation since Google Fonts is a real CDN, not a
  marketing site, but same class of external dependency.

## Where the design spec and fix history live

The original design handoff (`README.md` full visual/interaction spec,
`DEPLOY.md` — stale, assumes GitHub Pages when this actually deploys via
Cloudflare Workers, see "Deploy" above) and a `Taskplus Mobile.dc.html`
prototype live outside this repo, in the design bundle the human
originally supplied it from. A series of `FIX-*.md` documents (iOS-specific
bugs, render-loop, add-sheet spacing/fields, layout/safe-area, submit-
button spacing) were written against specific commits of this repo during
development and applied one at a time — if any are still around, they're
a live record of *why* things are shaped the way they are, worth reading
before changing the areas they touch.
