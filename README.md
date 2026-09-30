# blunderellaman.com

The link page for **digimate**: chess on Twitch, YouTube, TikTok and Instagram, plus a live
chess.com rating tracker for [blunderellaman](https://www.chess.com/member/blunderellaman).

Hand-written static HTML. There is no build step and no server.

| Path | What it is |
|------|------------|
| `site/index.html` | The link page and the rating tracker (reads the public chess.com API in the browser) |
| `site/beacon.js` | Sends a view and each link tap as a request for `/t.gif` |
| `site/admin/` | The stats page. It asks for a passphrase |
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
