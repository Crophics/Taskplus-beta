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
so they exercise actual production code, not reimplementations — **except**
`test/streak-notice.test.js`, whose own header says it "mirrors" (not
imports) `js/app.js`'s `getDailyStreakNotice`/`dismissDailyStreakNotice` —
**those two functions don't exist in `app.js` anymore** (the streak-banner
UI was dropped from the mobile redesign in favor of the Today header's
streak badge). That test file is currently testing a phantom copy of
removed logic; it still passes because it never touches the real app, but
it's not verifying anything live. Worth removing or rewriting, wasn't
touched this session to avoid deleting test coverage without being asked.

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
