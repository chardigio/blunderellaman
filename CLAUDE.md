# blunderellaman.com

Static link page for the blunderellaman chess streams. Read `README.md` first.

* No build step, no framework, no dependencies. Keep it that way.
* Run `npm test` after every change. Tests use `node:test`.
* Test logic in `site/beacon.js` and `site/admin/admin.js`. Both files use a UMD shape so the
  tests load the same file that the page runs. Keep new logic in these files, not inline.
* The `/t.gif` query keys (`e`, `ref`, `utm_source`, `l`) and the admin key derivation are a
  contract with the stats Lambda in the stardust-labs repo
  (`services/website_blunderellaman_dot_com/_infrastructure/stats_lambda/index.py`). A change
  here needs the same change there.
* A new link on the home page needs a `data-link="<name>"` attribute, or its taps are not
  counted. Add a label for the name in `LINK_LABELS` in `site/admin/admin.js`.
* The admin panel's Share links section is driven by `SHARE_SOURCES` in `site/admin/admin.js`.
* The page must work at 390px wide with no sideways scroll. Check it on a phone-sized window.
* Work on a branch named for the Linear issue (for example `STA-1234`). Open a PR to `main`.
  A merge to `main` deploys.
