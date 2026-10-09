# AGENTS.md

Wander Atlas (wanderatlasguides.com): an Astro travel guide, ~2,750 English posts (~2,460 live,
~280 quarantined drafts) across 25 countries, each translated into ko/ja/es/zh, published and
repaired by scheduled GitHub Actions. Deploys to Cloudflare Workers via `build-check.yml`
(GitHub Actions + wrangler), not Cloudflare's own Git builds. Counts here are from 2026-10-09;
`ls src/content/posts | wc -l` is the truth.

Read this before editing. Most of it is not style — it is where the money and the rankings are.

## Commands

```bash
npm test          # node --test — run the WHOLE suite, not one file (see below)
npm run ci        # lint-deps + astro check + tests: what CI runs
node --check <f>  # syntax only. NEVER "await import(<f>)" — that RUNS the script
```

`npm run build` is a full site build and takes 45–55 minutes. Don't reach for it to check a
change; the tests and `astro check` are the fast path.

## 🛑 Things that cost real money or real rankings

**Editing a post body re-translates it into four languages.** `srcHashOf()` (scripts/lib/src-hash.mjs)
hashes title + description + quickAnswer + faq + body. Any change re-queues that post's ko/ja/es/zh
translations. One punctuation sweep across the corpus is ~9,900 re-translations (2,460 live posts
× 4), on Opus 5.5. Translation is already ~57% of all Claude spend (`data/claude-cost.jsonl`).

**STOP and get explicit human approval before editing any post body.** Say how many posts and what
the re-translation will cost, then wait. "The user asked me to edit posts" is not that approval — it
is the request that triggers this rule. Warning about the cost and proceeding in the same breath
defeats the point: the human has to be able to say no while it is still free.

**`_redirects` silently truncates at 2,000 rules.** The cap was actually hit (2,027 rules) on
2026-10-05 and the build stopped. Since then quarantine no longer writes to `_redirects`: the
worker answers a would-be 404 of a held post with a 302 from `dist/quarantine-redirects.json`.
`_redirects` is generated at build time by astro.config.mjs (no file in `public/`) and still
carries region aliases, retired posts and twin merges at 5 lines each; it throws above 2,000 and
warns above 1,600.

**Redirect verb carries meaning.** Quarantine and parked itineraries are temporary → **302**.
Slug normalisations and twin merges are permanent → **301**. A 301 to a region hub is what ended
the rankings of 92 retired posts on 2026-07-26: the hub never names the venue, so the ranking does
not transfer, it dies.

**Publishing volume is an owner decision.** `data/publish-throttle.json` holds `postsPerRun` (10
since 2026-10-06, a cost decision) and `backfillPerRun` (25). Google has not indexed a new page
since 07-25 (indexed flat at ~5,200, Googlebot ~81 requests/day), and the 08-27 throttle experiment
was judged "backfired": volume was not the constraint, authority is. Do not change either number
without the owner; the history, thresholds and revisit dates are in that file and in
`data/index-coverage-baseline.json`. Know what the throttle covers: `postsPerRun` governs
`generate.mjs` only. `discover-events.mjs` (Mon/Thu, up to 4 events × 25 countries) and the
backfill chain are separate producers, so the site actually publishes ~50–60 posts/day
(October: 526 posts in 9 days). A "cut volume" that only touches `postsPerRun` cuts a fifth of it.

**Google Places calls are budgeted per day** (scripts/lib/places-budget.mjs). Place Details and Text
Search are each capped around 100/day and split between jobs (publish, backfill, refresh, quality).
A script that spends outside the ledger starves the 16:19 publish run, which has happened.

## Verification that is actually required

- **Run the full suite.** `node --test scripts/lib/foo.test.mjs` passing means nothing here — the
  repo has cross-cutting guards (a linter that rejects invisible characters in source, a workflow
  auditor, a dependency linter) that only fire on the whole run. Bare `node --test` finds ~1,900
  tests (1,916 on 2026-10-09) and all pass; if your run says otherwise, re-run before reporting it. Reporting a failure that
  is not there, and filing it under "pre-existing, unrelated to my change", is worse than reporting
  nothing: it launders a real failure into background noise.
- **Live over local.** `dist2/` may be weeks stale. Judging from a build artifact without checking
  its timestamp has produced wrong diagnoses. Prefer `curl` against production.
- **Consecutive curls return 000** — Cloudflare rate-limits them. Space them ~5s apart.
- **Never commit a literal invisible character** (BOM, zero-width space) in source. Write `\uFEFF`.
  `scripts/lint-regex.mjs` fails the build on it.

## Shared working tree

`C:\Users\user\wa-main` is used by several agent sessions at once. Stage your own paths explicitly
(`git add <path>`), never `git add -A` — another session's work-in-progress will ride along. Commit
soon after editing. Files are CRLF; a patch written with `\n` will match nothing and should report a
MISS rather than being loosened.

**Push through `scripts/git-push-retry.sh`, never a bare `git push`.** ~28 workflows commit to
`main` every day (30–60 commits/day). The script rebases remote-first (`-X ours`), resolves
modify/delete conflicts, re-parses the merged frontmatter, and since 2026-10-09 re-asserts the
recorded decisions (`draft` holds, `heldFinal`, hero pins) on the merged tree before pushing: a
clean merge used to leave a remote `heldFinal:` line beside a local `draft: false` and the held
post went live until the next day's patrol. If you add a new kind of decision that lives in
frontmatter, give it a `reassert-*.mjs` and list it in that script.

## Prose rules for anything readers see

English copy is generated by prompts, not written by hand. The house rules live in
`scripts/lib/prose-style.mjs` and every reader-facing generator imports `HOUSE_STYLE` (writer,
itineraries, essentials, region intros; `writer.mjs` joined on 2026-10-09, it had carried its own
copy of the rule). Chief among them: **no em-dashes** — they are the loudest machine-written tell,
and the writer prompt used to teach them by example. Add a new reader-facing generator, and it
should import that too.

Photos are the site's first quality axis: a hero must be the actual venue, verified. A post with no
usable photo is quarantined (`draft: true`), not published with a stand-in. Events are the one
exception that may ship photoless.

## Alerting is one channel

Every alert (~70 paths across the workflows) ends in one Telegram chat, read by one person. A
revoked bot token or a Telegram outage silences all of them at once, including
`job-failure-alert.yml`, whose two fallbacks are also Telegram. `sendTelegram()` throws on a
refusal so the job goes red, and GitHub mails the workflow's author on a failed scheduled run;
that mail is currently the only Telegram-free signal. Do not add a notifier that swallows errors.

## Where the reasoning lives

Commit messages carry the why. `git log --grep` before assuming something is a defect — several
things that look wrong here are deliberate, documented decisions (the retained `sitemap-0.xml`, the
404-page worker fallback, the AI-disclosure placement).
