#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  "HAS TODAY'S BATCH ALREADY RUN?" — ASKED BEFORE THE WORK, NOT INSIDE IT
//
//  generate.mjs has asked this since 2026-08-30, and the answer has been "yes"
//  every single day since the Cloudflare alarm clock started dispatching the
//  publish at 16:35 KST: GitHub's own schedule for the same slot arrives about
//  five hours late (measured 2026-09-20: median 304 minutes on this workflow),
//  finds the day guard, and writes no posts.
//
//  But generate is one step of forty. The other thirty-nine — photo backfills,
//  translations, itineraries, essentials, the social posts, the audits — ran
//  again anyway, for 84 to 87 minutes, every night. The guard was in the right
//  place to protect the POSTS and the wrong place to protect the PIPELINE.
//
//  So the same question is asked once, in its own job, and the whole workflow
//  is conditioned on the answer. Nothing else changes: the guard is active on
//  `schedule` events only (a manual or watchdog dispatch is deliberate), and it
//  fails open — an unreachable API answers "not served" and the day runs as it
//  always has.
//
//    node scripts/slot-served-output.mjs <workflow-file>
//
//  Prints `served=true|false` to $GITHUB_OUTPUT (and to stdout when run by hand).
// ─────────────────────────────────────────────────────────────
import { appendFileSync } from 'node:fs';
import { slotAlreadyServed } from './lib/slot-served.mjs';

const file = process.argv[2] || 'publish.yml';
const v = await slotAlreadyServed(file);

if (v.served) {
  console.log(`SLOT_SERVED: ${file} — run ${v.by} already did today's work; this late cron is standing down.`);
} else if (v.error) {
  console.log(`slot guard inconclusive (${v.error}) — running, because a broken guard must never skip a day.`);
} else if (v.active) {
  console.log(`SLOT_EMPTY: ${file} — nothing has served this slot today; running.`);
} else {
  console.log(`slot guard not active for this event (${process.env.GITHUB_EVENT_NAME || 'unknown'}) — running.`);
}

const line = `served=${v.served ? 'true' : 'false'}`;
console.log(line);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line + '\n');
