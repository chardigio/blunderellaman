# blunderellaman.com

The link page for **blunderellaman**: chess on Twitch, YouTube, TikTok and Instagram, plus a live
chess.com rating tracker for [blunderellaman](https://www.chess.com/member/blunderellaman).

Hand-written static HTML. There is no build step and no server.

| Path | What it is |
|------|------------|
| `site/index.html` | The link page and the rating tracker (reads the public chess.com API in the browser) |
| `site/beacon.js` | Sends a view and each link tap as a request for `/t.gif` |
| `site/admin/` | The stats page. It asks for a passphrase |
| `site/admin/queue/` | The shorts review queue. Email-code sign-in, through the admin API |
| `site/admin/api.js` | The sign-in and the client for the admin API at `api.blunderellaman.com`. Shared by every admin page that uses the API |
| `site/admin/bot/` | The blunderbot viewer and chat (see below). It signs in with an email code |
| `site/admin/vendor/` | Third-party files, unchanged: Deep Chat 2.5.1 (MIT) |
| `site/404.html`, `site/robots.txt`, `site/sitemap.xml` | The usual |

## Run it

```bash
npm test          # node --test, no dependencies
npm run serve     # http://localhost:8000
```

## Deploy

A push to `main` runs `.github/workflows/deploy.yml`: the tests, then `aws s3 sync` and a
CloudFront invalidation. It signs in to AWS with GitHub OIDC (the repo variable
`AWS_DEPLOY_ROLE_ARN`), so this repo holds no AWS keys.

The AWS side (S3, CloudFront, the certificate, DNS, the deploy role, and the stats job) is a CDK
stack in the private stardust-labs monorepo, at `services/website_blunderellaman_dot_com`.

## Analytics, with no analytics server

1. The page requests `/t.gif?e=view&ref=<origin>&utm_source=<tag>` on load and
   `/t.gif?e=tap&l=<link>` on each tap of an `a[data-link]`.
2. CloudFront writes every request to its access logs.
3. Each hour a Lambda reads the logs and writes the totals to `/admin/data/<key>.json`.
   `<key>` is PBKDF2-SHA256 of the admin passphrase (600,000 rounds).
4. `/admin/` derives the same key in the browser and fetches that file. A 404 means a wrong
   passphrase. The bucket does not allow listing, so nobody can find the file without the key.

The query keys in step 1 and the key derivation in step 3 are a contract with the Lambda. The
tests pin both (`test/beacon.test.js`, `test/admin.test.js`), and the Lambda's tests pin the
same key vector.

To tag a link you post, add `?utm_source=<name>`, for example
`https://blunderellaman.com/?utm_source=tiktok_bio`. The name shows on the stats page.
The admin panel has a Share links section with a ready-to-copy tagged link for each platform.

## The shorts queue

After each stream the clip bot uploads its cuts to the admin API. At `/admin/queue/` a reviewer
accepts or rejects each clip and can fix its title or set its time. The API gives each accepted
clip a time (three slots a day: 11 am, 3 pm and 7 pm Eastern) and plans the queue again after
every change, so the page never computes a schedule.

When a clip's time comes, Upload-Post posts it to YouTube Shorts and TikTok. The page shows
it under "Going out now" with each platform's state (sending, posted with a link, or failed
with the reason and the next try), and updates each minute. Nothing is manual. If the API
runs the `manual` fallback publisher, the page shows "Post now" with an "I posted it" button
for each platform.

On a wide screen the page shows the clips to review in a grid, with "Going out now",
"Scheduled" and "Done" in a side column. On a phone it shows one tab at a time. The page has
keyboard shortcuts (press `?` for the list): `J` and `K` move between clips, `A` accepts, `X`
rejects, `E` edits the title, and Enter in a title accepts or saves.

Only the emails on a list in the private stardust-labs repo can sign in, so this repo holds no
list and no secret. The API, the schedule rules, and the publisher are in
`services/blunderellaman/` there. To try the page locally, run that API on port 5558 (see its
README) and `npm run serve` here: on localhost the page calls `http://127.0.0.1:5558`.

## blunderbot viewer

`/admin/bot/` shows what blunderbot (the blunderellaman bot on Charlie's Mac) does, and has a
chat with it. It signs in with the email code from `site/admin/api.js`, then polls
`GET /bot/feed` on `https://api.blunderellaman.com` and sends with `POST /bot/messages`.
The Mac posts the bot's activity to that backend; nothing on the Mac accepts a connection.
The backend and the bot side are in the stardust-labs monorepo (`services/blunderellaman/`
and `_dev/scripts/imessage-claude/blunderweb/`).

The bubbles are drawn by [Deep Chat](https://github.com/OvidijusParsiunas/deep-chat), vendored
as one file in `site/admin/vendor/` so the site keeps no build step. `site/admin/bot.js`
decides what goes in them, and `test/bot.test.js` tests it. Every feed value is escaped
there, because Deep Chat puts the HTML into the page as it is.
