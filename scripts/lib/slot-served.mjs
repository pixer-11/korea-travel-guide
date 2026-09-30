// Slot guard — "has this cron slot's work already been done by another run?"
//
// Born 2026-08-29. The watchdog rescued pinterest and analytics-report at
// 12:22, and GitHub delivered the "dropped" originals hours later anyway
// (13:17 and 15:57) — six pins and two identical Telegram reports in one day.
// The watchdog cannot cancel GitHub's late delivery, so each workflow must
// recognize a served slot itself and bow out quietly.
//
// Active ONLY on `schedule` events. A manual dispatch is a human's explicit
// intent, and the watchdog's rescue dispatch fires only after confirming the
// slot empty — neither should be second-guessed. The duplicate in every
// observed incident was the late-arriving SCHEDULE run.
//
// Fails open on any API trouble: a broken guard must never kill the pipeline.
import { lastFireBefore } from './cron-window.mjs';
import { MANIFEST } from './cron-manifest.mjs';

// Matches the watchdog's early-queue tolerance: a run created minutes before
// its nominal slot time still belongs to that slot.
const EARLY_TOLERANCE_MS = 10 * 60000;

export async function slotAlreadyServed(workflowFile, {
  now = Date.now(),
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  if (env.GITHUB_EVENT_NAME !== 'schedule') return { active: false, served: false };
  const entry = MANIFEST.find((w) => w.file === workflowFile);
  const token = env.GITHUB_TOKEN;
  if (!entry || !token) return { active: false, served: false };
  const repo = env.GITHUB_REPOSITORY || 'pixer-11/korea-travel-guide';
  // Two window shapes. Default: this cron slot (a workflow with several slots
  // a day, like pinterest, must still run its later slots). guard:'kstDay':
  // the whole KST calendar day — publish promises ONE batch per day (throttle
  // experiment), so any success today serves it, whatever slot or trigger.
  // Inside the try: lastFireBefore throws on a cron field cron-window cannot
  // parse, and outside the try that exception killed the payload it guards —
  // the opposite of the fail-open contract above (Codex, 2026-09-02).
  try {
    // kstDay is the KST day the cron was MEANT to fire, not the day it arrived.
    // Until 2026-09-30 it was midnight of `now`: GitHub delivered 09-28's 16:19
    // publish at 00:37 on 09-29, the window started at 09-29 00:00, the 09-28
    // batch was outside it, and the late cron ran a full second publish — 32
    // posts and double the bill on 09-29, against the one-batch-a-day promise
    // the 10-07 throttle verdict depends on. The fire time (with the same early
    // tolerance as the slot shape, so a run queued a few minutes before 16:19
    // is not dated to yesterday) names the day; a batch that day serves it.
    let slotStart;
    if (entry.guard === 'kstDay') {
      const fired = Math.max(...entry.crons.map((c) => lastFireBefore(c, now + EARLY_TOLERANCE_MS)));
      slotStart = fired - ((fired + 9 * 3600000) % 86400000); // KST midnight of the fire day, as a UTC timestamp
    } else {
      slotStart = Math.max(...entry.crons.map((c) => lastFireBefore(c, now))) - EARLY_TOLERANCE_MS;
    }
    const since = new Date(slotStart).toISOString();
    const res = await fetchImpl(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/runs` +
        `?created=${encodeURIComponent('>=' + since)}&per_page=10`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return { active: false, served: false, error: `HTTP ${res.status}` };
    const runs = (await res.json()).workflow_runs ?? [];
    // Only a finished SUCCESS counts as "served" — a failed or cancelled
    // attempt must not suppress the retry that would finally do the work.
    // created_at is re-checked here even though the API call already filters:
    // trusting the server filter alone left the window unenforced in any
    // context that returns unfiltered runs (the tests caught exactly that).
    const candidates = runs.filter(
      (r) => String(r.id) !== String(env.GITHUB_RUN_ID)
        && r.conclusion === 'success'
        && Date.parse(r.created_at) >= slotStart,
    );
    // A run that stood down on this very guard also ends in `success`. Once the
    // window became the cron's own day, 09-29's 00:37 stand-down sat inside
    // 09-29's window and would have "served" 09-29's real 16:19 cron (Codex,
    // 2026-09-30). Where the manifest names the job that does the work, only a
    // run whose job actually succeeded counts. A jobs lookup that fails counts
    // as not served — the guard's fail-open contract.
    let hit = null;
    for (const r of candidates) {
      if (!entry.workJob) { hit = r; break; }
      const jr = await fetchImpl(
        `https://api.github.com/repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
      );
      if (!jr.ok) continue;
      const jobs = (await jr.json()).jobs ?? [];
      if (jobs.some((j) => j.name === entry.workJob && j.conclusion === 'success')) { hit = r; break; }
    }
    return { active: true, served: Boolean(hit), by: hit?.id, slotStart };
  } catch (e) {
    return { active: false, served: false, error: e?.message ?? String(e) };
  }
}

// Drop-in for the top of a payload script: exits 0 (quietly, before any
// external side effect) when the slot is already served.
export async function exitIfSlotServed(workflowFile) {
  const v = await slotAlreadyServed(workflowFile);
  if (v.served) {
    console.log(
      `SLOT_SERVED: ${workflowFile} — run ${v.by} already served this slot; ` +
        'a late-delivered cron is exiting without repeating the work.',
    );
    process.exit(0);
  }
  if (v.error) console.log(`slot guard inconclusive (${v.error}) — proceeding.`);
  return v;
}
