#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  IS A NEWER RUN OF THIS WORKFLOW ALREADY ON ITS WAY?
//
//  build-check is what ships the site, and it always checks out `ref: main` —
//  a queued run does not build its own commit, it builds the tip. So when three
//  pushes land inside one build, all three runs build the SAME tree, one after
//  the other. A build of this site took 69 to 171 minutes over the last twelve
//  deploys (median 88), so that is hours of queue for one result.
//
//  cancel-in-progress is deliberately off here and must stay off: GitHub counts
//  a cancelled run as FAILED and emails about it, which is how the one alert
//  that matters — the site frozen on an old version — got buried in noise
//  (the reasoning sits above the concurrency block in build-check.yml).
//
//  Standing down is not cancelling. A run that can see a newer sibling exits
//  green with a sentence saying why, the newer one ships the same tip, and no
//  commit goes unshipped: the newest run never sees anything newer than itself.
//
//  Never stands down a manual dispatch — that is a human saying "ship now".
//  Fails open: if the API cannot be reached, the build runs.
//
//    node scripts/newer-run-exists.mjs <workflow-file>
//
//  Prints `superseded=true|false` to $GITHUB_OUTPUT.
// ─────────────────────────────────────────────────────────────
import { appendFileSync } from 'node:fs';

const file = process.argv[2] || 'build-check.yml';
const env = process.env;
const say = (msg, superseded) => {
  console.log(msg);
  const line = `superseded=${superseded ? 'true' : 'false'}`;
  console.log(line);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, line + '\n');
  process.exit(0);
};

if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
  say('a manual dispatch is never stood down — building.', false);
}
const token = env.GITHUB_TOKEN;
const runId = env.GITHUB_RUN_ID;
if (!token || !runId) say('no token or run id — building.', false);

const repo = env.GITHUB_REPOSITORY || 'pixer-11/korea-travel-guide';
let runs;
try {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?per_page=20`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) say(`run list unavailable (HTTP ${res.status}) — building.`, false);
  runs = (await res.json()).workflow_runs ?? [];
} catch (e) {
  say(`run list unreachable (${e.message}) — building.`, false);
}

const mine = runs.find((r) => String(r.id) === String(runId));
if (!mine) say('this run is not in the listing yet — building.', false);

// Newer AND still alive. A newer run that already failed or was cancelled
// shipped nothing, so standing down for it would leave the tip unpublished.
const newer = runs.find(
  (r) => String(r.id) !== String(runId)
    && Date.parse(r.created_at) > Date.parse(mine.created_at)
    && r.conclusion !== 'failure' && r.conclusion !== 'cancelled' && r.conclusion !== 'timed_out',
);
if (newer) {
  say(
    `SUPERSEDED: run ${newer.id} (${newer.created_at}) is newer and builds the same tip — standing down instead of building main twice.`,
    true,
  );
}
say('no newer run — this one ships the tip.', false);
