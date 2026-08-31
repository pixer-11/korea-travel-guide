// wa-social-alarm — a Cloudflare cron that wakes the GitHub social workflow.
//
// GitHub's scheduler is best-effort and this week it has been dropping whole
// morning slots (2026-08-29: threads-daily's 07:25 and 08:25 KST crons left no
// run at all; the day before, all three fired 6-11 hours late). Cloudflare's
// cron is punctual, so this worker dispatches the workflow itself at 07:30 KST.
//
// Firing on a morning GitHub already handled is safe twice over: the workflow
// has a queueing concurrency group + `ref: main` checkout, and
// threads-daily.mjs stamps the KST day it sent on, so a second run exits on
// the day guard without posting.
//
// Secrets (set locally via scripts/deploy-social-alarm.sh — wrangler is logged
// in on the owner's PC):
//   GH_DISPATCH_TOKEN  - PAT used only for POST /dispatches
//   FIRE_KEY           - guards the manual test endpoint (POST /fire with
//                        `Authorization: Bearer <key>` — a header, not a query
//                        string, so the key stays out of URL logs)
//
// Telegram secrets are NOT set in production, on purpose: if this worker fails,
// the existing net (three GitHub crons + schedule-watchdog, which telegrams
// when it rescues) still delivers, and a second bell on the same door only
// trains the owner to ignore both. The alertFailures() path below stays wired
// so the secrets can be added later without a code change; with none set it
// returns without sending. A failed dispatch also REJECTS the scheduled
// handler, so Cloudflare's cron history records it — the direct trace we keep.

const REPO = 'pixer-11/korea-travel-guide';
const TARGETS = ['threads-daily.yml'];

export async function fireDispatches(env, fetchImpl = fetch) {
  const results = [];
  for (const workflow of TARGETS) {
    let status = 0;
    let ok = false;
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
    results.push({ workflow, status, ok });
  }
  return results;
}

export async function alertFailures(env, results, fetchImpl = fetch) {
  const failed = results.filter((r) => !r.ok);
  if (!failed.length || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return failed;
  const lines = failed.map((f) => `- ${f.workflow}: HTTP ${f.status}`).join('\n');
  await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: `⏰ 소셜 알람시계가 깃허브를 깨우지 못했습니다:\n${lines}\n(깃허브 자체 크론 3회 + 감시견이 예비로 남아 있습니다. 토큰 만료라면 GH_DISPATCH_TOKEN 교체 필요.)`,
    }),
  });
  return failed;
}

export default {
  async scheduled(controller, env, ctx) {
    const results = await fireDispatches(env);
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
    return new Response('wa-social-alarm: cron 30 22 * * * (07:30 KST)', { status: 200 });
  },
};
