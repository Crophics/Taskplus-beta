# One-time setup: Moodle import Worker

The Worker code ships with the site, but it answers `/api/moodle/*` with
**503 "not configured"** until you add two things in Cloudflare. Until then the
rest of the site works exactly as before.

You need `npx wrangler` logged in to the Cloudflare account that owns
`beta.taskplus.cc` (`npx wrangler login`).

## 1. Create the key-value store

```bash
npx wrangler kv namespace create MOODLE_KV
```

It prints an `id`. In `wrangler.toml`, uncomment the `[[kv_namespaces]]` block at
the bottom and paste that id in. Commit the change.

(The Worker keeps one small encrypted record per user here: their Moodle address,
Moodle access token and course selection. The password is never stored.)

## 2. Add the encryption key

Generate 32 random bytes, base64 encoded, and store it as a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put TOKEN_ENC_KEY
```

Paste the generated value when asked. Keep a copy somewhere safe: if this key is
lost or changed, every stored Moodle connection becomes unreadable and each user
has to connect again (nothing else breaks).

## 3. Deploy

Pushing to `main` deploys through GitHub Actions as before. Or:

```bash
npx wrangler deploy
```

## 3b. Claude estimates (optional, recommended)

Without this the app still works: it keeps its rule-of-thumb time estimates. With it, Claude reads each
assignment's description, estimates the time and names the steps.

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Create the key at console.anthropic.com. **Put it in its own workspace with a monthly spend limit** so a
bug or a stranger can never run up a bill; that limit is the real safety net.

**What it costs (a rough estimate, not measured):** each estimate is one request of roughly 1,000 to 2,000
input tokens and a few hundred output tokens plus some thinking. The default model, Claude Opus 5.5, is
$4 per million input tokens and $20 per million output, so on the order of a cent or two per assignment.
An assignment is only sent once: the answer is cached for 180 days and re-used until Moodle changes the
assignment's text. Built-in limits: 60 requests per user per day and 300 per day across everyone.

### Free alternative: Google Gemini

Instead of (or without) an Anthropic key, estimates can come from Google's Gemini API, which has a free tier:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Create the key in Google AI Studio (aistudio.google.com). With only `GEMINI_API_KEY` set, Gemini answers; if both
keys exist, Claude is used unless `ESTIMATE_PROVIDER` is `gemini` (`claude` forces Claude). The default model is
`gemini-3.5-flash-lite` (override with `ESTIMATE_MODEL`). Handout PDFs are sent inline, like with Claude.
Free-tier limits and Gemini's use of free-tier content for improving Google's products are Google's terms, not ours:
check them. (The app never sends notes, grades, account ids or credentials; only assignment text and handouts.)
The same answer checks, caching and daily caps apply as for Claude.

Optional Worker variables (set in `wrangler.toml` under `[vars]` or in the dashboard):

| Variable | Effect |
|---|---|
| `ESTIMATE_MODEL` | Use another model, e.g. `claude-sonnet-5-5` or `claude-haiku-5-5` (cheaper, probably a little less careful). Default `claude-opus-5-5`. |
| `ESTIMATE_FALLBACKS` | `off` turns off the server-side refusal fallback (on by default). |
| `ESTIMATE_DAILY_LIMIT` / `ESTIMATE_GLOBAL_DAILY_LIMIT` | Change the 60 / 300 daily caps. |
| `ESTIMATE_READ_FILES` | `off` turns off reading PDF handouts for everyone (the per-user Settings switch still exists). |
| `ESTIMATE_FILE_DAILY_LIMIT` | Handout-reading requests per user per day (default 20). Reading a PDF costs far more than reading text. |
| `INVITE_CODES` | Optional, a secret (`npx wrangler secret put INVITE_CODES`): comma-separated invite codes. When set, connecting Moodle needs one (the app asks for it when needed; use long random codes, 16+ characters, and give each friend their own so one can be removed). People already connected are not affected. Leave unset to keep connecting open. |
| `ALLOWED_UIDS` | Comma-separated Firebase user ids allowed to use Claude estimates. Leave unset to allow every connected user. |

Only the assignment's title, points, description, file names and submission type go to Anthropic. Never
grades, notes, your Moodle login or your account id. Each user can switch it off in Settings.

**Handouts.** With the second Settings switch ("Also read attached PDFs", on by default) the Worker also
downloads the PDFs attached to the assignment itself (up to 2 per assignment, 5 MB each) from your own Moodle,
using your stored token, and sends them to Claude so it can split the real questions into steps. It only ever
fetches files on the site you connected, refuses redirects, and checks the file really is a PDF. It never sends
your submissions or anything outside the assignment's own attachments. **PDFs cost much more than text** (a
page is many times the tokens of a paragraph), so expect a handout-heavy assignment to cost several times the
text-only price; each handout is read once and the answer cached, and the daily file cap limits the rest. Word
documents, slides and images are not read.

The Worker now imports the Anthropic SDK, so the GitHub workflow runs `npm ci` before deploying.

## 3c. Alerts when the app is closed (optional)

Without this the app still shows **What's new** (the bell on Today) after every sync. With it, the Worker
syncs Moodle in the background about every 3 hours, only between 06:00 and 21:00 in your time zone (a cron runs every 30 minutes) and sends a push for new
assignments, moved due dates, and "due tomorrow" / "due within the hour".

1. Firebase console > Project settings > Service accounts. Create a **dedicated** service account (Google Cloud
   console > IAM) with only the role **Firebase Cloud Messaging API Admin**, and create a JSON key for it.
   Do not reuse an admin key: this key lives in the Worker.
2. Store it as a secret (paste the whole JSON when asked):

```bash
npx wrangler secret put FCM_SERVICE_ACCOUNT
```

3. Deploy. In the app, open Settings, turn on Notification permission, then use **Moodle alerts > Send a test**.

Notes:
- Production's `dailyDueDigest` already sends a daily digest for manually added items. The Worker only covers
  imported Moodle work, so you will not get duplicates.
- On iPhone, web push only works after you add the site to the Home Screen.
- The first sync after connecting is a baseline: it never announces assignments you already have.
- Quiet hours hold alerts and send them together afterwards. Each device registered for alerts is stored
  (encrypted) in KV; at most 5 per user, and dead ones are dropped automatically.
- `CRON_SUBREQUEST_BUDGET` (default 45) caps outgoing requests per cron run (Cloudflare free plan: 50). With many
  users, the least recently served go first.

## Optional

- `SUBREQUEST_BUDGET` (a Worker variable, default 40): the most Moodle calls one
  sync may make. A sync uses 3 fixed calls, plus one submission check per assignment/quiz (soonest due first). Cloudflare's free plan allows 50 outgoing requests per Worker
  invocation, so 40 leaves headroom. On a paid plan you can raise it so every
  assignment's submission status is checked on every sync; on the free plan,
  items beyond the budget are checked on the next sync instead.
- Moodle has to allow the mobile web service (the same one the Obsidian sync used).
  If a school turns it off, Connect fails with "does not allow mobile app access".

## Checking it works

Sign in to Taskplus on `beta.taskplus.cc`, open Settings, and use **Connect
Moodle**. A wrong password shows "Moodle did not accept that username or
password"; a missing setup step shows "The server is not set up for Moodle yet".
