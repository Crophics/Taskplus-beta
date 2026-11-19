# Taskplus (mobile beta)

A mobile-first rebuild of [Taskplus](https://taskplus.cc), a task and
assignment planner PWA for tracking coursework. This is the **beta**:
a three-tab (Today, Week, All), thumb-friendly redesign of the original
single-scroll desktop app, built around importing work from Moodle, live at [beta.taskplus.cc](https://beta.taskplus.cc). Production
(`taskplus.cc`, [`Crophics/Taskplus`](https://github.com/Crophics/Taskplus))
is untouched — this is a separate repo/deploy on purpose, so nothing here
can break it.

## Features

- **Moodle import** — connect your school's Moodle once and your assignments
  and quizzes arrive on their own, with due dates and times. Your password is
  used once to get an access token and is never stored; the token is kept
  encrypted on the server so it can also check for changes while the app is closed.
- **Today** — the day's required work. Multi-part assignments get a daily
  target; hit it and the item drops into "Get ahead" (optional) instead of
  disappearing.
- **Time estimates** — each imported assignment gets an estimate, split into
  parts (one part per day, never more parts than usable days). The estimate
  comes from an AI service (Gemini or Claude, whichever the server uses) or a
  rule of thumb, and learns from how long your finished work really took. You can
  edit the plan or the numbers yourself.
- **Week** — a paced-load chart of what lands on each day, in minutes.
- **All** — every assignment, grouped by due date or by course, with search and
  a course filter. Overdue work you no longer need can be ignored.
- **Alerts** — push notifications for new assignments, moved due dates and
  things due soon, even with the app closed (on iPhone, from the Home Screen app).
- **Onboarding** — a first-run flow (invite code when the server asks for one,
  Google sign-in, Moodle), then a tour that shows the real app with sample data.
  Replay it from Settings → About.
- **Your data** — sync across devices through your Google account, backup and
  import, calendar export, and a **Delete my data** button that removes
  everything from the server and the device. A plain-language privacy page is
  at [`/privacy`](./privacy.html).
- Installable PWA with offline support.

## Tech stack

- Vanilla JS, HTML, CSS — no framework, no bundler. Every module attaches
  to `window` under a `TPXxx` namespace and loads via a plain `<script>`
  tag in a fixed order (see `index.html`).
- Firebase (Auth, Firestore, Cloud Messaging) — shared with production's
  `planner-88ab8` project for sign-in, sync and push delivery.
- A Cloudflare Worker (`src/`) hosts the app and the `/api` routes: Moodle
  import, AI estimates, alerts and a 30-minute background check, with KV storage
  for the encrypted token and snapshots. Custom domain `beta.taskplus.cc`.
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
│   ├── tour.js / demo-data.js  the intro tour (real app in a sandboxed preview)
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
├── src/                         the Worker: routes, Moodle client, estimates, alerts, push
├── docs/                        setup, plan and cutover notes
├── tools/                       small one-off scripts (vault comparison)
├── privacy.html                 the privacy page
├── test/                        node --test tests (logic, Worker, tour isolation)
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

Cloud Functions (production's scheduled digest) are **not** deployed from this
repo — see `AGENTS.md`'s "Firebase" section for why. The Worker's secrets
(`TOKEN_ENC_KEY`, `FCM_SERVICE_ACCOUNT`, an AI key, optionally `INVITE_CODES`) are
set with `wrangler secret put`; the one-time setup is in
[`docs/SETUP-moodle-worker.md`](./docs/SETUP-moodle-worker.md).

## Push notifications

Alerts are sent by this repo's Worker (`src/push.mjs`, `src/fcm.mjs`) through
Firebase Cloud Messaging, using a service-account key stored as the Worker secret
`FCM_SERVICE_ACCOUNT` (see [`docs/SETUP-moodle-worker.md`](./docs/SETUP-moodle-worker.md)).
The background handler lives inside [`sw.js`](./sw.js), the same service worker
that does offline caching; a browser origin can have only one service worker per
scope, so don't register a second. The VAPID key in
[`js/fcm-config.js`](./js/fcm-config.js) is public and copied from production.
iPhone has several traps (alerts only from the Home Screen app, the page must not
use `new Notification()`); `AGENTS.md` lists them. Production's own daily digest
still comes from its Cloud Function.

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
