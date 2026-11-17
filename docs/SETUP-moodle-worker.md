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

## Optional

- `SUBREQUEST_BUDGET` (a Worker variable, default 40): the most Moodle calls one
  sync may make. A sync uses 3 fixed calls, plus one grade report per selected
  course, plus one submission check per assignment/quiz (soonest due first). Cloudflare's free plan allows 50 outgoing requests per Worker
  invocation, so 40 leaves headroom. On a paid plan you can raise it so every
  assignment's submission status is checked on every sync; on the free plan,
  items beyond the budget are checked on the next sync instead.
- Moodle has to allow the mobile web service (the same one the Obsidian sync used).
  If a school turns it off, Connect fails with "does not allow mobile app access".

## Checking it works

Sign in to Taskplus on `beta.taskplus.cc`, open Settings, and use **Connect
Moodle**. A wrong password shows "Moodle did not accept that username or
password"; a missing setup step shows "The server is not set up for Moodle yet".
