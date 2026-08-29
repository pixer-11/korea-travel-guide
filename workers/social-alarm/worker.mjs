// wa-social-alarm — a Cloudflare cron that wakes the GitHub social workflow.
//
// GitHub's scheduler is best-effort and this week it has been dropping whole
// morning slots (2026-08-29: threads-daily's 07:25 and 08:25 KST crons left no
// run at all; the day before, all three fired 6-11 hours late). Cloudflare's
// cron is punctual, so this worker dispatches the workflow itself at 07:30 KST.
//
// Firing on a morning GitHub already handled is safe twice over: the workflow
// has a queueing concurrency group, and threads-daily.mjs stamps the KST day it
// sent on, so a second run exits on the day guard without posting.
//
// Secrets (set by deploy-social-alarm.yml from GitHub Secrets):
//   GH_DISPATCH_TOKEN  - PAT used only for POST /dispatches
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID - failure alerts (Korean, silent on success)
//   FIRE_KEY           - guards the manual /fire test endpoint

const REPO = 'pixer-11/korea-travel-guide';
const TARGETS = ['threads-daily.yml'];

export async function fireDispatches(env, fetchImpl = fetch) {
  const results = [];
  for (const workflow of TARGETS) {
    let status = 0;
    try {
      const res = await fetchImpl(
        `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'wa-social-alarm',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        },
      );
      status = res.status;
    } catch {
      status = -1; // network failure — as dead as a 4xx for our purposes
    }
    results.push({ workflow, status, ok: status === 204 });
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
    ctx.waitUntil(alertFailures(env, results));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/fire') {
      if (!env.FIRE_KEY || url.searchParams.get('key') !== env.FIRE_KEY) {
        return new Response('forbidden', { status: 403 });
      }
      const results = await fireDispatches(env);
      await alertFailures(env, results);
      return Response.json(results);
    }
    return new Response('wa-social-alarm: cron 30 22 * * * (07:30 KST)', { status: 200 });
  },
};
