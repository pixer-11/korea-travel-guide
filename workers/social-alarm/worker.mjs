// wa-social-alarm — a punctual Cloudflare cron that wakes GitHub workflows
// GitHub's own scheduler is too late (or too absent) to wake on time.
//
// GitHub's scheduler is best-effort and this week it has been dropping whole
// morning slots (2026-08-29: threads-daily's 07:25 and 08:25 KST crons left no
// run at all; the day before, all three fired 6-11 hours late). Cloudflare's
// cron is punctual, so this worker dispatches the workflow itself at 07:30 KST.
//
// 2026-08-31 — measured, 14 days, 244 scheduled fires across 26 daily
// workflows: median 44 min late, 44% over an hour, 27% over three hours, 13%
// over six, worst 12.2h, and 3.2% of slots never delivered at all. Lateness is
// the rule here, not the incident. That day the 16:19 publish never fired AND
// publish-watchdog — the single-cron dog that exists to catch exactly that —
// was dropped with it, so nothing rescued publishing until the evening sweep
// did it by hand. A watchdog on GitHub's scheduler shares the illness it
// treats. So the alarm now also wakes THE WATCHDOGS on time: one punctual
// dispatch of schedule-watchdog rescues its whole manifest, which is why this
// buys the entire roster with three crons instead of one per workflow.
//
// Firing on a morning GitHub already handled is safe twice over: the workflow
// has a queueing concurrency group + `ref: main` checkout, and
// threads-daily.mjs stamps the KST day it sent on, so a second run exits on
// the day guard without posting. The same holds for the watchdogs by
// construction — a watchdog whose wards all ran is a no-op that telegrams
// nothing, and check-publish-ran is slot-based, so it stays silent on a slot
// already served.
//
// Secrets (set locally via scripts/deploy-social-alarm.sh — wrangler is logged
// in on the owner's PC):
//   GH_DISPATCH_TOKEN  - PAT used only for POST /dispatches
//   FIRE_KEY           - guards the manual test endpoint (POST /fire with
//                        `Authorization: Bearer <key>` — a header, not a query
//                        string, so the key stays out of URL logs)
//
// Telegram secrets ARE set here, since 2026-09-01. They were deliberately
// absent before, on the reasoning that the existing net (three GitHub crons +
// schedule-watchdog, which telegrams when it rescues) still delivers, so a
// second bell on the same door would only train the owner to ignore both.
// That reasoning was about the WORK getting done and it still holds. What it
// missed is this worker itself: nothing watches the alarm clock. Its likeliest
// death is GH_DISPATCH_TOKEN expiring, and with no bell here that surfaces
// only as the watchdog quietly rescuing more often — the symptom, never the
// cause. The alert names the cause. It fires only on a dispatch GitHub refused
// after retries, i.e. a real and persistent problem, and is silent otherwise.
// A failed dispatch also REJECTS the scheduled handler, so Cloudflare's cron
// history records it either way; that stays the primary trace, and the alert
// is forbidden from overwriting it (see alertFailures).

const REPO = 'pixer-11/korea-travel-guide';

// Which workflow each Cloudflare cron wakes. The keys must match
// wrangler.jsonc's `triggers.crons` exactly — cron-targets.test.mjs holds the
// two files to each other, because a key that matches nothing is a cron that
// fires ALL_TARGETS every day (the fallback below) and a cron that matches no
// key is a workflow nobody wakes.
//
// Each entry fires five minutes after the GitHub cron it backs up, so that on
// a day GitHub is punctual we queue behind the real run and the guard exits.
export const SCHEDULE = {
  // 07:30 KST — threads-daily's own first cron is 07:25.
  '30 22 * * *': ['threads-daily.yml'],
  // 18:53 KST — schedule-watchdog's own 09:48 UTC slot. Sweeps the morning
  // roster (publish, indexnow, analytics, alt-photos, reddit…) on time.
  '53 9 * * *': ['schedule-watchdog.yml'],
  // 19:35 KST — publish-watchdog's own 10:30 UTC slot. Dispatched directly
  // rather than via schedule-watchdog, whose 100-minute grace would hold the
  // rescue until 12:10 UTC and push publishing past its day.
  '35 10 * * *': ['publish-watchdog.yml'],
  // 23:23 KST — schedule-watchdog's own 14:18 UTC slot. Catches the evening
  // roster (pinterest, threads, refresh) before the KST day rolls over.
  '23 14 * * *': ['schedule-watchdog.yml'],
};

export const ALL_TARGETS = [...new Set(Object.values(SCHEDULE).flat())];

// An unrecognised cron wakes everything rather than nothing: every target is
// guarded and idempotent, so over-firing costs a no-op run, while under-firing
// costs the day's work. A drifted key should never be the quiet failure.
export const targetsFor = (cron) => SCHEDULE[cron] ?? ALL_TARGETS;

// One attempt is not enough against a GitHub that is currently unwell. On
// 2026-08-31 the 14:23 UTC wake-up left no run at all while the 22:30 one
// worked with the same code and the same token, and GitHub Actions has been
// degraded since 08-26 — a transient 5xx is the likeliest reading, and a
// single-shot dispatch turns it into a silently skipped day. Retries are safe
// because every target is guarded: the worst case of firing twice is a no-op
// run. 4xx is NOT retried — a bad token or a missing workflow_dispatch trigger
// will answer the same way forever, and hammering it only hides the cause.
// Injectable so the tests can prove the retry without sleeping through it —
// five real seconds per case would have added 40% to the whole suite's runtime
// to assert something the delay values have nothing to do with.
export const RETRY_DELAYS_MS = [1000, 4000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fireDispatches(env, fetchImpl = fetch, targets = ALL_TARGETS, delays = RETRY_DELAYS_MS) {
  const results = [];
  for (const workflow of targets) {
    let status = 0;
    let ok = false;
    let attempts = 0;
    for (let i = 0; i <= delays.length; i++) {
      if (i) await sleep(delays[i - 1]);
      attempts++;
      try {
        const res = await fetchImpl(
          `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
              Accept: 'application/vnd.github+json',
              // Pinned: unversioned requests follow GitHub's moving default,
              // and newer API versions answer a dispatch with 200+run details
              // instead of 204 — which the 204-only check would call a failure.
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'wa-social-alarm',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ref: 'main' }),
          },
        );
        status = res.status;
        ok = status === 204 || res.ok === true;
      } catch {
        status = -1; // network failure — as dead as a 4xx for our purposes
      }
      if (ok) break;
      if (status >= 400 && status < 500) break; // permanent: retrying changes nothing
    }
    results.push({ workflow, status, ok, attempts });
  }
  return results;
}

export async function alertFailures(env, results, fetchImpl = fetch) {
  const failed = results.filter((r) => !r.ok);
  if (!failed.length || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return failed;
  const lines = failed.map((f) => `- ${f.workflow}: HTTP ${f.status}`).join('\n');
  // Everything below is swallowed ON PURPOSE. The alert is the courtesy; the
  // dispatch failure is the news, and scheduled() throws it on the next line —
  // that message is what Cloudflare's cron history keeps. A Telegram outage
  // must not overwrite `dispatch failed: ...` with a fetch error of its own.
  // This is deliberately the opposite of scripts/lib/telegram.mjs, where the
  // send IS the errand and a refusal has to fail the job. Here it is a second
  // copy of news already recorded, so it never rejects. (The window opened on
  // 2026-09-01: with no Telegram secrets this code was unreachable.)
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: `⏰ 소셜 알람시계가 깃허브를 깨우지 못했습니다:\n${lines}\n(깃허브 자체 크론 3회 + 감시견이 예비로 남아 있습니다. 토큰 만료라면 GH_DISPATCH_TOKEN 교체 필요.)`,
      }),
    });
    if (res && res.ok === false) console.error(`telegram alert refused: HTTP ${res.status}`);
  } catch (e) {
    console.error(`telegram alert not delivered: ${e.message}`);
  }
  return failed;
}

export default {
  async scheduled(controller, env, ctx) {
    const results = await fireDispatches(env, fetch, targetsFor(controller?.cron));
    const failed = await alertFailures(env, results);
    if (failed.length) {
      throw new Error(
        `dispatch failed: ${failed.map((f) => `${f.workflow}=${f.status}`).join(', ')}`,
      );
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/fire') {
      const auth = request.headers.get('Authorization') || '';
      if (request.method !== 'POST' || !env.FIRE_KEY || auth !== `Bearer ${env.FIRE_KEY}`) {
        return new Response('forbidden', { status: 403 });
      }
      const results = await fireDispatches(env);
      await alertFailures(env, results);
      const allOk = results.every((r) => r.ok);
      return Response.json(results, { status: allOk ? 200 : 502 });
    }
    return new Response(`wa-social-alarm: ${Object.keys(SCHEDULE).length} crons`, { status: 200 });
  },
};
