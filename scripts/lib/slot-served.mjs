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
    const slotStart = entry.guard === 'kstDay'
      ? now - ((now + 9 * 3600000) % 86400000) // KST midnight, as a UTC timestamp
      : Math.max(...entry.crons.map((c) => lastFireBefore(c, now))) - EARLY_TOLERANCE_MS;
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
    const hit = runs.find(
      (r) => String(r.id) !== String(env.GITHUB_RUN_ID)
        && r.conclusion === 'success'
        && Date.parse(r.created_at) >= slotStart,
    );
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
