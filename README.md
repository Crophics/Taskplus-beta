# Taskplus (mobile beta)

A mobile-first rebuild of [Taskplus](https://taskplus.cc), a task and
assignment planner PWA for tracking coursework. This is the **beta**:
a five-tab, thumb-friendly redesign of the original single-scroll desktop
app, live at [beta.taskplus.cc](https://beta.taskplus.cc). Production
(`taskplus.cc`, [`Crophics/Taskplus`](https://github.com/Crophics/Taskplus))
is untouched — this is a separate repo/deploy on purpose, so nothing here
can break it.

## Features

- **Today** — the day's required work, one thumb, top of the app. Each
  multi-part assignment tracks a units-logged-today counter against a
  daily pacing target; hit it and the item drops into "Get ahead" instead
  of disappearing.
- **All** — search, sort (urgency / due date / course), filter by course,
  drag to reorder, long-press for quick actions (log, complete, push out a
  day, edit, delete).
- **Week** — a paced-load chart: each open item spreads its remaining
  units evenly across the days it has left, so the chart shows real daily
  workload, not just a due-date count. Broken down by course, with a
  by-course completion view and a plain-language advice line.
- **Settings** — theme (dark "Nocturne" / light / blue / auto), daily
  digest hour, sync, backup/import, calendar export.
- **Courses** — a real collection with per-course colors, replacing the
  old free-text course field. Renaming a course relabels every assignment
  under it; deleting one leaves existing assignments alone.
- Multi-part assignments get a daily target so you stay on pace; task
  dependencies (locked until a same-course prerequisite is done); weekly/
  monthly recurring assignments; notes and subtasks (behind a disclosure
  in the add sheet, to keep the common case — title/course/due/amount —
  fast one-handed).
- Installable PWA with offline support; cross-device sync via Firestore
  with tombstone-based deletion; daily push notification digest at
  whatever local hour you pick.

## Tech stack

- Vanilla JS, HTML, CSS — no framework, no bundler. Every module attaches
  to `window` under a `TPXxx` namespace and loads via a plain `<script>`
  tag in a fixed order (see `index.html`).
- Firebase (Firestore, Cloud Functions v2, Cloud Messaging) — shared with
  production's `planner-88ab8` project for auth/sync/push.
- Cloudflare Workers for hosting, custom domain `beta.taskplus.cc`.
- GitHub Actions for CI/CD — **every push to `main` that passes tests
  deploys automatically**, no manual step.

See [`AGENTS.md`](./AGENTS.md) for the deep architectural notes, known
gotchas, and the reasoning behind non-obvious choices — read that before
making structural changes.

## Project structure

```
taskplus-beta/
├── js/
│   ├── app.js                 state, storage, sync, render()/patch()/buildApi()
│   ├── bind-events.js         wires every DOM event handler after each render
│   ├── boot.js                auth UI + service worker registration
│   ├── courses.js             courses collection: migration, rename/delete/add
│   ├── all-logic.js           All-tab search/sort/filter/grouping (pure)
│   ├── week-logic.js          paced-load computation (pure)
│   ├── today-logic.js         daily pacing model + Today/Get-ahead bucketing
│   ├── item-logic.js          task-dependency lock logic
│   ├── icons.js                inline-SVG icon set (TPIcons.svg)
│   ├── theme.js                theme switching
│   ├── notify.js               local/foreground notifications
│   ├── io.js                   backup export/import, .ics calendar export
│   ├── toast.js / html.js      toast notifications, HTML-escaping helpers
│   ├── utils.js                dates, formatting, confetti
│   ├── fcm-config.js           FCM client config (VAPID key)
│   └── views/                  one *-html.js per screen/component
├── css/
│   ├── tokens.css               theme tokens (--bg/--surface/--accent/etc)
│   ├── mobile.css               page shell + every component
│   └── animations.css           @keyframes + prefers-reduced-motion
├── test/                        node --test unit tests for the pure logic modules
├── functions/                   present but inert - production owns this deploy
├── firebase-sync.js             cross-device sync + push token management
├── sw.js                        service worker (offline cache + FCM background)
├── index.html
├── manifest.json
├── wrangler.toml                Cloudflare Worker config, beta.taskplus.cc route
├── firebase.json / .firebaserc
└── .github/workflows/deploy.yml
```

## Setup

### Local dev

No build step — open `index.html` directly, or serve the directory with
any static file server (`npx serve .`, `python3 -m http.server`, etc.).

```bash
npm install     # dev dependency: eslint
npm test        # node --test over test/*.test.js
npm run lint    # eslint js/
```

### Deploy

```bash
npx wrangler deploy      # site -> Cloudflare Workers, beta.taskplus.cc
```

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the
test suite and then deploys automatically on success. Needs these repo
secrets (already configured):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Cloud Functions (the scheduled digest) are **not** deployed from this
repo — see `AGENTS.md`'s "Firebase" section for why.

## Push notifications

Background reminders (app closed) need the same three pieces as
production, since this shares its Firebase project:

Note: the FCM background handler lives inside [`sw.js`](./sw.js), the same
service worker that handles offline caching, not a separate file. Don't
register a second service worker at the same scope, a browser origin can
only have one active service worker per scope.

1. **VAPID key** — already copied into [`js/fcm-config.js`](./js/fcm-config.js)
   from production's Firebase Console (Project settings → Cloud Messaging
   → Web Push certificates). Redeploy the site if it ever changes.
2. **Enable reminders in the app** — sign in, then tap Enable Reminders
   under Settings and allow notifications. Tokens save under
   `users/{uid}/taskplus/fcm` in Firestore.
3. **Scheduled digests** — handled entirely by production's
   `dailyDueDigest` Cloud Function; nothing to deploy from this repo.

## The pacing model, briefly

Each assignment carries a `today` counter — units logged during the
current calendar day, reset once at load when the stored last-active date
differs from today. `dayTarget(item)`/`met(item)` (in
[`js/today-logic.js`](./js/today-logic.js)) compute the day's target and
whether it's been hit; logging a unit increments `done` and `today`
together. An item whose daily target is met drops from "Today's targets"
into "Get ahead" rather than disappearing, so getting ahead of pace is
visible, not just implicit. See `AGENTS.md` for the full bucketing logic
(required-tight / required-pace / optional pick-buckets), which is more
nuanced than this summary and was deliberately kept that way rather than
simplified.
